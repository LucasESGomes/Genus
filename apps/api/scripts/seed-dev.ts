/**
 * Semente de DESENVOLVIMENTO (idempotente): conta, empresa, estabelecimento, chave da empresa (DEK),
 * escala 5x2, regra de banco de horas e um usuário RH, para o portal e o totem web funcionarem num
 * banco vazio. A escala é ligada aos colaboradores ativos sem nenhuma (rode de novo depois de
 * cadastrá-los). Nunca rodar em produção.
 *
 *   MASTER_KEY=<64 hex, a mesma da engine> pnpm --filter @genus/api rh:seed-dev
 *
 * Dados fictícios (CNPJ/CAEPF de teste). A senha do RH (NEW_USER_PASSWORD ou gerada) e os ids vão para
 * `dev-data/seed-dev.json` (pasta fora do Git), não para o terminal.
 * A DEK é cifrada com a MASTER_KEY da engine: é ela que decifra a DEK no cadastro facial e no reconhecimento.
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createLogger, encryptDek, generateDek } from '@genus/shared';
import pg from 'pg';
import { loadEnv } from '../src/config/env';
import { createDatabase } from '../src/db/client';
import { toStoredCompanyKey } from '../src/modules/facial/stored-crypto';
import { UserService } from '../src/modules/auth/user-service';

const env = loadEnv();
if (env.appEnv === 'prod') throw new Error('seed-dev não roda em produção');
const masterKey = process.env.MASTER_KEY;
if (!masterKey || !/^[0-9a-fA-F]{64}$/.test(masterKey)) throw new Error('Defina MASTER_KEY (64 hex, a mesma da engine)');
const ownerUrl = process.env.RH_MIGRATION_DATABASE_URL;
if (!ownerUrl) throw new Error('Defina RH_MIGRATION_DATABASE_URL (apps/api/.env.dev)');

const RH_EMAIL = 'rh@genus.dev';
const OUT = fileURLToPath(new URL('../../../dev-data/seed-dev.json', import.meta.url));

const pool = new pg.Pool({ connectionString: ownerUrl, max: 1 });
const one = async <T>(text: string, values: unknown[] = []) => (await pool.query(text, values)).rows[0] as T | undefined;

try {
  await pool.query('BEGIN');
  const tenant =
    (await one<{ id: string }>("SELECT id FROM rh.contas WHERE nome = 'Genus Demonstração'")) ??
    (await one<{ id: string }>("INSERT INTO rh.contas (nome) VALUES ('Genus Demonstração') RETURNING id"));
  const tenantId = Number(tenant!.id);

  const company =
    (await one<{ id: string }>('SELECT id FROM rh.empresas WHERE conta_id = $1 AND cnpj = $2', [tenantId, '11222333000181'])) ??
    (await one<{ id: string }>(
      "INSERT INTO rh.empresas (conta_id, razao_social, cnpj) VALUES ($1, 'Agropecuária Santa Helena Ltda (fictícia)', '11222333000181') RETURNING id",
      [tenantId],
    ));
  const companyId = Number(company!.id);

  const establishment =
    (await one<{ id: string }>('SELECT id FROM rh.estabelecimentos WHERE empresa_id = $1 AND inscricao = $2', [companyId, '112223330001'])) ??
    (await one<{ id: string }>(
      "INSERT INTO rh.estabelecimentos (conta_id, empresa_id, nome, tipo_inscricao, inscricao, uf, municipio_ibge) VALUES ($1, $2, 'Fazenda Santa Helena', 'CAEPF', '112223330001', 'GO', '5218805') RETURNING id",
      [tenantId, companyId],
    ));
  const establishmentId = Number(establishment!.id);

  const hasKey = await one('SELECT 1 FROM rh.chaves_empresa WHERE conta_id = $1 AND empresa_id = $2 AND eh_ativa', [tenantId, companyId]);
  if (!hasKey) {
    const k = toStoredCompanyKey(encryptDek(generateDek(), masterKey), 1);
    await pool.query(
      'INSERT INTO rh.chaves_empresa (conta_id, empresa_id, versao_chave, dek_iv, dek_tag, dek_ct, versao_kek) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [tenantId, companyId, k.keyVersion, k.dekIv, k.dekTag, k.dekCt, k.masterKeyVersion],
    );
  }
  const schedule =
    (await one<{ id: string }>("SELECT id FROM rh.escalas WHERE conta_id = $1 AND estabelecimento_id = $2 AND nome = 'Comercial 5x2'", [tenantId, establishmentId])) ??
    (await one<{ id: string }>(
      "INSERT INTO rh.escalas (conta_id, estabelecimento_id, nome, tipo, ciclo_tipo, carga_semanal_min) VALUES ($1, $2, 'Comercial 5x2', '5x2', 'semanal', 2400) RETURNING id",
      [tenantId, establishmentId],
    ));
  const scheduleId = Number(schedule!.id);
  // Segunda (1) a sexta (5), 8 h com 1 h de intervalo; dia sem linha é folga.
  await pool.query(
    `INSERT INTO rh.dias_escala (conta_id, escala_id, posicao, entrada, saida, intervalo_inicio, intervalo_fim)
     SELECT $1, $2, dia, '07:00', '16:00', '11:00', '12:00' FROM generate_series(1, 5) AS dia
     ON CONFLICT (escala_id, posicao) DO NOTHING`,
    [tenantId, scheduleId],
  );
  await pool.query(
    `INSERT INTO rh.colaboradores_escalas (conta_id, colaborador_id, escala_id, vigencia_inicio)
     SELECT c.conta_id, c.id, $3, c.data_admissao FROM rh.colaboradores c
      WHERE c.conta_id = $1 AND c.estabelecimento_id = $2 AND c.data_desligamento IS NULL
        AND NOT EXISTS (SELECT 1 FROM rh.colaboradores_escalas e WHERE e.conta_id = c.conta_id AND e.colaborador_id = c.id)`,
    [tenantId, establishmentId, scheduleId],
  );

  // Regra do banco de horas do estabelecimento: sem ela, a apuração não lança nada.
  await pool.query(
    `INSERT INTO rh.regras_banco_horas (conta_id, estabelecimento_id, modalidade, peso_domingo, peso_feriado, vigencia_inicio)
     SELECT $1, $2, 'individual_6m', 1.00, 1.00, DATE '2026-01-01'
      WHERE NOT EXISTS (SELECT 1 FROM rh.regras_banco_horas WHERE conta_id = $1 AND estabelecimento_id = $2)`,
    [tenantId, establishmentId],
  );
  await pool.query('COMMIT');

  // Usuário RH pelo serviço real (hash de senha do Better Auth).
  const existing = await one('SELECT 1 FROM rh.usuarios WHERE email = $1', [RH_EMAIL]);
  let password: string | null = null;
  if (!existing) {
    password = process.env.NEW_USER_PASSWORD ?? randomBytes(12).toString('base64url');
    const database = createDatabase(env.databaseUrl, createLogger({ level: 'warn', service: 'seed-dev' }), 1);
    try {
      await new UserService({ db: database.db }).createUser({ email: RH_EMAIL, name: 'Lúcia Martins', role: 'rh', tenantId, employeeId: null, password });
    } finally {
      await database.close();
    }
  }

  mkdirSync(fileURLToPath(new URL('../../../dev-data/', import.meta.url)), { recursive: true });
  const record = { geradoEm: new Date().toISOString(), tenantId, companyId, establishmentId, rh: { email: RH_EMAIL, senha: password ?? '(já existia: senha anterior)' } };
  if (password) writeFileSync(OUT, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`Semente ok: conta=${tenantId} empresa=${companyId} estabelecimento=${establishmentId}. ${password ? 'Credenciais em dev-data/seed-dev.json' : 'Usuário RH já existia.'}\n`);
} catch (err) {
  await pool.query('ROLLBACK').catch(() => undefined);
  process.stderr.write(`Falha: ${(err as Error).message}\n`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
