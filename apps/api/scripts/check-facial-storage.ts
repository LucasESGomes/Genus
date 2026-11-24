/**
 * Confere, contra o banco do RH e o face-engine REAIS, que a biometria salva no
 * banco funciona com a criptografia dupla já pronta (packages/shared/src/crypto.ts):
 *
 *   1. abre UMA transação no banco app e cria conta, duas empresas, colaborador
 *      e consentimento fictícios;
 *   2. grava a DEK de cada empresa cifrada com a MASTER_KEY real e um embedding
 *      sintético cifrado com a DEK da empresa do colaborador;
 *   3. lê tudo de volta do banco e manda à engine (POST /cache/warm, que decifra
 *      a DEK com a MASTER_KEY e o embedding com a DEK);
 *   4. espera 200 com o dado salvo, 422 com um byte adulterado e 422 com a DEK
 *      de outra empresa;
 *   5. limpa o cache da engine e faz ROLLBACK: nada fica no banco.
 *
 * Não usa fotos nem dados reais. Nunca imprime chave nem embedding.
 * Roda dentro da rede do compose (a engine não publica porta no host):
 *
 *   docker compose run --rm --no-deps -e MASTER_KEY -e ENGINE_API_KEY \
 *     -e ENGINE_URL=http://face-engine:8001 -e RH_DATABASE_URL api \
 *     node_modules/.bin/tsx scripts/check-facial-storage.ts
 *
 * Sai com código 1 se alguma conferência falhar.
 */
import { randomBytes } from 'node:crypto';
import { encryptDek, encryptEmbedding, generateDek, l2Normalize } from '@genus/shared';
import pg from 'pg';
import {
  engineTenantId,
  fromStoredCompanyKey,
  fromStoredEmbedding,
  toStoredCompanyKey,
  toStoredEmbedding,
} from '../src/modules/facial/stored-crypto';

const out = (line = '') => process.stdout.write(`${line}\n`);

const { MASTER_KEY: masterKey, ENGINE_URL: engineUrl, ENGINE_API_KEY: engineApiKey, RH_DATABASE_URL: rhUrl } = process.env;
if (!masterKey || !engineUrl || !engineApiKey || !rhUrl) {
  process.stderr.write('MASTER_KEY, ENGINE_URL, ENGINE_API_KEY e RH_DATABASE_URL são obrigatórias\n');
  process.exit(1);
}

// Hash de PIN fictício só para satisfazer o NOT NULL; nunca é conferido.
const FAKE_PIN_HASH = 'scrypt$1$32768$8$1$AQEBAQEBAQEBAQEBAQEBAQ$AAAA';

function syntheticEmbedding(): Float32Array {
  const bytes = randomBytes(512 * 4);
  const v = new Float32Array(512);
  for (let i = 0; i < 512; i++) v[i] = bytes.readUInt32LE(i * 4) / 0x1_0000_0000 - 0.5;
  return l2Normalize(v);
}

async function engine(method: string, path: string, body?: unknown): Promise<number> {
  const res = await fetch(new URL(path, engineUrl), {
    method,
    headers: { 'X-API-Key': engineApiKey as string, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  await res.arrayBuffer();
  return res.status;
}

interface Row {
  [k: string]: unknown;
}

async function main(): Promise<boolean> {
  const client = new pg.Client({ connectionString: rhUrl });
  await client.connect();
  const one = async (sql: string, params: unknown[]): Promise<Row> => (await client.query(sql, params)).rows[0] as Row;
  const tenants: string[] = [];
  let ok = true;
  const check = (label: string, got: number, want: number) => {
    const pass = got === want;
    ok &&= pass;
    out(`${pass ? 'OK  ' : 'FALHA'} ${label}: HTTP ${got} (esperado ${want})`);
  };

  try {
    await client.query('BEGIN');
    const suffix = String(Date.now() % 1_000_000).padStart(6, '0');
    const tenantId = Number((await one("INSERT INTO rh.contas (nome) VALUES ('Conferência biometria (rollback)') RETURNING id", [])).id);
    const company = async (n: number) =>
      Number(
        (
          await one('INSERT INTO rh.empresas (conta_id, razao_social, cnpj) VALUES ($1, $2, $3) RETURNING id', [
            tenantId,
            `Conferência ${n}`,
            `99${suffix}00010${n}`,
          ])
        ).id,
      );
    const companyA = await company(1);
    const companyB = await company(2);
    const establishmentId = (
      await one(
        `INSERT INTO rh.estabelecimentos (conta_id, empresa_id, nome, tipo_inscricao, inscricao, uf, municipio_ibge)
         VALUES ($1, $2, 'Conferência', 'CNPJ', $3, 'SP', '3550308') RETURNING id`,
        [tenantId, companyA, `99${suffix}000101`],
      )
    ).id;
    const employeeId = Number(
      (
        await one(
          `INSERT INTO rh.colaboradores (conta_id, estabelecimento_id, cpf, nome, data_nascimento, data_admissao, pin_hash, pin_definido_em)
           VALUES ($1, $2, $3, 'Pessoa Fictícia', '1990-01-01', '2025-01-01', $4, now()) RETURNING id`,
          [tenantId, establishmentId, `000${suffix}00`, FAKE_PIN_HASH],
        )
      ).id,
    );
    const consentId = (
      await one(
        `INSERT INTO rh.consentimentos_biometricos (conta_id, colaborador_id, versao_texto, consentido_em)
         VALUES ($1, $2, 'conferencia', now()) RETURNING id`,
        [tenantId, employeeId],
      )
    ).id;

    // Camada 2: DEK de cada empresa cifrada com a MASTER_KEY real, gravada no banco.
    const deks = new Map<number, Buffer>();
    for (const companyId of [companyA, companyB]) {
      const dek = generateDek();
      deks.set(companyId, dek);
      const k = toStoredCompanyKey(encryptDek(dek, masterKey as string), 1);
      await client.query(
        `INSERT INTO rh.chaves_empresa (conta_id, empresa_id, versao_chave, dek_iv, dek_tag, dek_ct, versao_kek)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [tenantId, companyId, k.keyVersion, k.dekIv, k.dekTag, k.dekCt, k.masterKeyVersion],
      );
    }

    // Camada 1: embedding cifrado com a DEK da empresa do colaborador (o que a engine devolve no cadastro).
    const e = toStoredEmbedding(encryptEmbedding(syntheticEmbedding(), deks.get(companyA) as Buffer));
    await client.query(
      `INSERT INTO rh.embeddings_faciais
         (conta_id, colaborador_id, empresa_id, consentimento_id, versao_chave, embedding_iv, embedding_tag, embedding_ct,
          versao_modelo, qtd_imagens, origem)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'arcface_r50_v1', 3, 'portal')`,
      [tenantId, employeeId, companyA, consentId, e.keyVersion, e.embeddingIv, e.embeddingTag, e.embeddingCt],
    );

    // Lê de volta do banco, exatamente como o coletor fará.
    const readKey = async (companyId: number) => {
      const r = await one('SELECT versao_chave, versao_kek, dek_iv, dek_tag, dek_ct FROM rh.chaves_empresa WHERE empresa_id = $1 AND eh_ativa', [
        companyId,
      ]);
      const dek = fromStoredCompanyKey({
        keyVersion: Number(r.versao_chave),
        masterKeyVersion: Number(r.versao_kek),
        dekIv: r.dek_iv as Buffer,
        dekTag: r.dek_tag as Buffer,
        dekCt: r.dek_ct as Buffer,
      });
      return { dek_ct: dek.ciphertextHex, dek_iv: dek.ivHex, dek_tag: dek.tagHex, key_version: dek.keyVersion };
    };
    const r = await one(
      'SELECT versao_chave, embedding_iv, embedding_tag, embedding_ct FROM rh.embeddings_faciais WHERE conta_id = $1 AND colaborador_id = $2',
      [tenantId, employeeId],
    );
    const stored = fromStoredEmbedding({
      keyVersion: Number(r.versao_chave),
      embeddingIv: r.embedding_iv as Buffer,
      embeddingTag: r.embedding_tag as Buffer,
      embeddingCt: r.embedding_ct as Buffer,
    });
    const candidate = (ctHex: string) => ({
      person_id: employeeId,
      embedding_iv: stored.ivHex,
      embedding_tag: stored.tagHex,
      embedding_ct: ctHex,
      key_version: stored.keyVersion,
    });
    // inverte os bits do primeiro byte do ciphertext
    const tampered = ((parseInt(stored.ciphertextHex.slice(0, 2), 16) ^ 0xff).toString(16).padStart(2, '0')) + stored.ciphertextHex.slice(2);

    // tenant_id próprio por conferência: o cache de DEK da engine nunca reaproveita uma chave antiga
    const runId = randomBytes(4).toString('hex');
    const tenantA = `${engineTenantId(companyA)}-conferencia-${runId}`;
    const tenantB = `${engineTenantId(companyB)}-conferencia-${runId}`;
    tenants.push(tenantA, tenantB);

    out('Banco do RH → face-engine (POST /cache/warm):');
    check('dado salvo no banco: a engine decifra as duas camadas', await engine('POST', '/cache/warm', {
      tenant_id: tenantA,
      tenant_dek: await readKey(companyA),
      candidates: [candidate(stored.ciphertextHex)],
    }), 200);
    check('byte adulterado no banco: a engine recusa (InvalidTag)', await engine('POST', '/cache/warm', {
      tenant_id: tenantA,
      tenant_dek: await readKey(companyA),
      candidates: [candidate(tampered)],
    }), 422);
    check('DEK de outra empresa: a engine recusa (InvalidTag)', await engine('POST', '/cache/warm', {
      tenant_id: tenantB,
      tenant_dek: await readKey(companyB),
      candidates: [candidate(stored.ciphertextHex)],
    }), 422);
    await engine('DELETE', `/embeddings/${tenantA}/${employeeId}`);
  } finally {
    for (const t of tenants) await engine('DELETE', `/cache/dek/${t}`).catch(() => 0);
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end();
    out('Transação desfeita (ROLLBACK): nada ficou no banco; cache da engine limpo.');
  }
  return ok;
}

main()
  .then((ok) => process.exit(ok ? 0 : 1))
  .catch((err: unknown) => {
    // Só nome e mensagem curta: nunca valores de chave ou embedding.
    const e = err as { name?: string; code?: string; message?: string };
    process.stderr.write(`Falha na conferência: ${e.name ?? 'Error'} ${e.code ?? ''} ${(e.message ?? '').slice(0, 200)}\n`);
    process.exit(1);
  });
