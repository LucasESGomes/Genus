/**
 * Provisiona uma conta (tenant) de cliente: conta, empresa, estabelecimento, chave da empresa (DEK) e o
 * primeiro usuário `admin`. Serve para o primeiro acesso em produção, enquanto o painel do super_admin
 * (CRUD de contas) não existe. Idempotente por nome da conta / CNPJ / e-mail. Dados da empresa são
 * PLACEHOLDERS: corrija no portal (Configurações) antes de usar de verdade.
 *
 *   MASTER_KEY=<64 hex, a mesma da engine> RH_MIGRATION_DATABASE_URL=... NEW_USER_PASSWORD=... \
 *   ADMIN_EMAIL=admin@empresa.com ADMIN_NAME="Admin" TENANT_NAME="Minha Empresa" \
 *   [COMPANY_NAME=... COMPANY_CNPJ=14 dígitos ESTABLISHMENT_NAME=...] tsx scripts/provision-tenant.ts
 */
import { createLogger, encryptDek, generateDek } from '@genus/shared';
import pg from 'pg';
import { loadEnv } from '../src/config/env';
import { createDatabase } from '../src/db/client';
import { toStoredCompanyKey } from '../src/modules/facial/stored-crypto';
import { UserService } from '../src/modules/auth/user-service';

const need = (n: string): string => {
  const v = process.env[n];
  if (!v) throw new Error(`Defina ${n}`);
  return v;
};

const env = loadEnv();
const masterKey = need('MASTER_KEY');
if (!/^[0-9a-fA-F]{64}$/.test(masterKey)) throw new Error('MASTER_KEY deve ter 64 hex');
const ownerUrl = need('RH_MIGRATION_DATABASE_URL');
const tenantName = need('TENANT_NAME');
const adminEmail = need('ADMIN_EMAIL');
const adminName = need('ADMIN_NAME');
const password = need('NEW_USER_PASSWORD');
const companyName = process.env.COMPANY_NAME ?? `${tenantName} (editar)`;
const cnpj = process.env.COMPANY_CNPJ ?? '11222333000181';
const establishmentName = process.env.ESTABLISHMENT_NAME ?? 'Matriz (editar)';

const pool = new pg.Pool({ connectionString: ownerUrl, max: 1 });
const one = async <T>(text: string, values: unknown[] = []) => (await pool.query(text, values)).rows[0] as T | undefined;

try {
  await pool.query('BEGIN');
  const tenant =
    (await one<{ id: string }>('SELECT id FROM rh.contas WHERE nome = $1', [tenantName])) ??
    (await one<{ id: string }>('INSERT INTO rh.contas (nome) VALUES ($1) RETURNING id', [tenantName]));
  const tenantId = Number(tenant!.id);

  const company =
    (await one<{ id: string }>('SELECT id FROM rh.empresas WHERE conta_id = $1 AND cnpj = $2', [tenantId, cnpj])) ??
    (await one<{ id: string }>('INSERT INTO rh.empresas (conta_id, razao_social, cnpj) VALUES ($1, $2, $3) RETURNING id', [tenantId, companyName, cnpj]));
  const companyId = Number(company!.id);

  const inscricao = `${cnpj.slice(0, 8)}0001`.padEnd(12, '0');
  const establishment =
    (await one<{ id: string }>('SELECT id FROM rh.estabelecimentos WHERE empresa_id = $1 AND inscricao = $2', [companyId, inscricao])) ??
    (await one<{ id: string }>(
      "INSERT INTO rh.estabelecimentos (conta_id, empresa_id, nome, tipo_inscricao, inscricao, uf, municipio_ibge) VALUES ($1, $2, $3, 'CAEPF', $4, 'GO', '5218805') RETURNING id",
      [tenantId, companyId, establishmentName, inscricao],
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
  await pool.query('COMMIT');

  const existing = await one('SELECT 1 FROM rh.usuarios WHERE email = $1', [adminEmail]);
  if (!existing) {
    const database = createDatabase(env.databaseUrl, createLogger({ level: 'warn', service: 'provision-tenant' }), 1);
    try {
      await new UserService({ db: database.db }).createUser({ email: adminEmail, name: adminName, role: 'admin', tenantId, employeeId: null, password });
    } finally {
      await database.close();
    }
  }
  process.stdout.write(`ok: conta=${tenantId} empresa=${companyId} estabelecimento=${establishmentId} admin=${adminEmail} ${existing ? '(já existia)' : '(criado)'}\n`);
} catch (err) {
  await pool.query('ROLLBACK').catch(() => undefined);
  process.stderr.write(`Falha: ${(err as Error).message}\n`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
