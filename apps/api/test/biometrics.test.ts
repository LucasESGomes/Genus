/**
 * Biometria no banco do RH (migrations 0004 e 0005), contra Postgres real.
 *
 * Prova que o que fica SALVO no banco continua funcionando com a criptografia
 * dupla já pronta (packages/shared/src/crypto.ts, a mesma do face-engine):
 * DEK da empresa cifrada com a MASTER_KEY e embedding cifrado com a DEK.
 * Aqui nada se cifra de outro jeito: só se grava, lê de volta e confere.
 * MASTER_KEY e embeddings são de teste (aleatórios), nunca dados reais.
 */
import { decryptDek, decryptEmbedding, encryptDek, encryptEmbedding, generateDek, l2Normalize } from '@genus/shared';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  engineTenantId,
  fromStoredCompanyKey,
  fromStoredEmbedding,
  toStoredCompanyKey,
  toStoredEmbedding,
  type StoredCompanyKey,
  type StoredEmbedding,
} from '../src/modules/facial/stored-crypto';
import { FAKE_PIN_HASH, FAKE_PIN_SET_AT } from './support/fake-pin';
import { startRhTestDatabase, type RhTestDatabase } from './support/rh-database';

let db: RhTestDatabase;
let client: pg.Client;
let seq = 0;

const MASTER_KEY = randomBytes(32).toString('hex');

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  const r = await client.query(sql, params);
  return r.rows[0] as T;
}

async function sqlState(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return undefined;
}

function randomEmbedding(): Float32Array {
  const bytes = randomBytes(512 * 4);
  const v = new Float32Array(512);
  for (let i = 0; i < 512; i++) v[i] = bytes.readUInt32LE(i * 4) / 0x1_0000_0000 - 0.5;
  return l2Normalize(v);
}

interface Org {
  tenantId: number;
  companyA: number;
  companyB: number;
  establishmentA: number;
}

/** Conta com duas empresas (A e B); o estabelecimento é da empresa A. */
async function createOrg(): Promise<Org> {
  seq += 1;
  const tenantId = (await one<{ id: number }>('INSERT INTO rh.contas (nome) VALUES ($1) RETURNING id', [`Conta Bio ${seq}`])).id;
  const company = async (n: number) =>
    (
      await one<{ id: number }>('INSERT INTO rh.empresas (conta_id, razao_social, cnpj) VALUES ($1, $2, $3) RETURNING id', [
        tenantId,
        `Empresa ${seq}-${n} Ltda`,
        String(98_765_432_000_100 + seq * 10 + n),
      ])
    ).id;
  const companyA = await company(1);
  const companyB = await company(2);
  const establishmentA = (
    await one<{ id: number }>(
      `INSERT INTO rh.estabelecimentos (conta_id, empresa_id, nome, tipo_inscricao, inscricao, uf, municipio_ibge)
       VALUES ($1, $2, 'Fazenda', 'CNPJ', $3, 'MG', '3106200') RETURNING id`,
      [tenantId, companyA, String(98_765_432_000_100 + seq * 10 + 1)],
    )
  ).id;
  // o pg devolve bigint como string
  return { tenantId: Number(tenantId), companyA: Number(companyA), companyB: Number(companyB), establishmentA: Number(establishmentA) };
}

async function newEmployee(org: Org): Promise<number> {
  seq += 1;
  return (
    await one<{ id: number }>(
      `INSERT INTO rh.colaboradores (conta_id, estabelecimento_id, cpf, nome, data_nascimento, data_admissao, pin_hash, pin_definido_em)
       VALUES ($1, $2, $3, 'Pessoa Fictícia', '1990-01-01', '2025-01-01', $4, $5) RETURNING id`,
      [org.tenantId, org.establishmentA, String(30_000_000_000 + seq), FAKE_PIN_HASH, FAKE_PIN_SET_AT],
    )
  ).id;
}

async function newConsent(org: Org, employeeId: number): Promise<number> {
  return (
    await one<{ id: number }>(
      `INSERT INTO rh.consentimentos_biometricos (conta_id, colaborador_id, versao_texto, consentido_em, endereco_ip)
       VALUES ($1, $2, 'v1-teste', '2026-11-20T10:00:00Z', '192.0.2.10') RETURNING id`,
      [org.tenantId, employeeId],
    )
  ).id;
}

/** Cria e grava a DEK da empresa, cifrada com a MASTER_KEY (como o serviço fará). Devolve a DEK em claro só para o teste. */
async function storeCompanyKey(org: Org, companyId: number, keyVersion = 1): Promise<Buffer> {
  const dek = generateDek();
  const stored = toStoredCompanyKey(encryptDek(dek, MASTER_KEY), keyVersion);
  await client.query(
    `INSERT INTO rh.chaves_empresa (conta_id, empresa_id, versao_chave, dek_iv, dek_tag, dek_ct, versao_kek)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [org.tenantId, companyId, stored.keyVersion, stored.dekIv, stored.dekTag, stored.dekCt, stored.masterKeyVersion],
  );
  return dek;
}

async function readCompanyKey(companyId: number): Promise<StoredCompanyKey> {
  const r = await one<{ versao_chave: number; versao_kek: number; dek_iv: Buffer; dek_tag: Buffer; dek_ct: Buffer }>(
    'SELECT versao_chave, versao_kek, dek_iv, dek_tag, dek_ct FROM rh.chaves_empresa WHERE empresa_id = $1 AND eh_ativa',
    [companyId],
  );
  return { keyVersion: r.versao_chave, masterKeyVersion: r.versao_kek, dekIv: r.dek_iv, dekTag: r.dek_tag, dekCt: r.dek_ct };
}

function insertEmbedding(
  org: Org,
  e: { employeeId: number; consentId: number; companyId: number; stored: StoredEmbedding },
) {
  return client.query(
    `INSERT INTO rh.embeddings_faciais
       (conta_id, colaborador_id, empresa_id, consentimento_id, versao_chave, embedding_iv, embedding_tag, embedding_ct,
        versao_modelo, qtd_imagens, origem)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'arcface_r50_v1', 3, 'portal') RETURNING id`,
    [
      org.tenantId,
      e.employeeId,
      e.companyId,
      e.consentId,
      e.stored.keyVersion,
      e.stored.embeddingIv,
      e.stored.embeddingTag,
      e.stored.embeddingCt,
    ],
  );
}

async function readEmbedding(employeeId: number): Promise<StoredEmbedding> {
  const r = await one<{ versao_chave: number; embedding_iv: Buffer; embedding_tag: Buffer; embedding_ct: Buffer }>(
    'SELECT versao_chave, embedding_iv, embedding_tag, embedding_ct FROM rh.embeddings_faciais WHERE colaborador_id = $1',
    [employeeId],
  );
  return { keyVersion: r.versao_chave, embeddingIv: r.embedding_iv, embeddingTag: r.embedding_tag, embeddingCt: r.embedding_ct };
}

beforeAll(async () => {
  db = await startRhTestDatabase();
  client = new pg.Client({ connectionString: db.url });
  await client.connect();
});

afterAll(async () => {
  await client?.end();
  await db?.stop();
});

describe('criptografia dupla: o que fica salvo no banco do RH funciona', () => {
  let org: Org;
  let dekA: Buffer;
  let dekB: Buffer;
  let employeeId: number;
  let original: Float32Array;

  beforeAll(async () => {
    org = await createOrg();
    dekA = await storeCompanyKey(org, org.companyA);
    dekB = await storeCompanyKey(org, org.companyB);
    employeeId = await newEmployee(org);
    const consentId = await newConsent(org, employeeId);
    original = randomEmbedding();
    // o que a engine devolve: embedding cifrado com a DEK da empresa do colaborador
    await insertEmbedding(org, { employeeId, consentId, companyId: org.companyA, stored: toStoredEmbedding(encryptEmbedding(original, dekA)) });
  });

  it('a DEK sai do banco e decifra com a MASTER_KEY (camada 2)', async () => {
    const dek = decryptDek(fromStoredCompanyKey(await readCompanyKey(org.companyA)), MASTER_KEY);
    expect(dek.equals(dekA)).toBe(true);
  });

  it('o embedding sai do banco e decifra igual ao original com a DEK da própria empresa (camada 1)', async () => {
    const dek = decryptDek(fromStoredCompanyKey(await readCompanyKey(org.companyA)), MASTER_KEY);
    const back = decryptEmbedding(fromStoredEmbedding(await readEmbedding(employeeId)), dek);
    expect(Array.from(back)).toEqual(Array.from(original));
  });

  it('cada empresa tem a sua chave: a DEK de outra empresa não decifra', async () => {
    expect(dekA.equals(dekB)).toBe(false);
    const stored = fromStoredEmbedding(await readEmbedding(employeeId));
    expect(() => decryptEmbedding(stored, dekB)).toThrow();
    // e a DEK da empresa B, guardada no banco, também abre com a MASTER_KEY (é outra chave válida)
    expect(decryptDek(fromStoredCompanyKey(await readCompanyKey(org.companyB)), MASTER_KEY).equals(dekB)).toBe(true);
  });

  it('MASTER_KEY errada não abre a DEK', async () => {
    const wrongMaster = randomBytes(32).toString('hex');
    const stored = fromStoredCompanyKey(await readCompanyKey(org.companyA));
    expect(() => decryptDek(stored, wrongMaster)).toThrow();
  });

  it('um byte adulterado no banco é detectado (tag GCM)', async () => {
    // inverte todos os bits de um byte do ciphertext, direto no banco
    await client.query(
      'UPDATE rh.embeddings_faciais SET embedding_ct = set_byte(embedding_ct, 99, get_byte(embedding_ct, 99) # 255) WHERE colaborador_id = $1',
      [employeeId],
    );
    const dek = decryptDek(fromStoredCompanyKey(await readCompanyKey(org.companyA)), MASTER_KEY);
    const tampered = fromStoredEmbedding(await readEmbedding(employeeId));
    expect(() => decryptEmbedding(tampered, dek)).toThrow();
  });

  it('tenant_id da engine identifica a empresa', () => {
    expect(engineTenantId(org.companyA)).toBe(`empresa-${org.companyA}`);
    expect(engineTenantId(org.companyA)).not.toBe(engineTenantId(org.companyB));
  });
});

describe('regras do banco (0004 e 0005)', () => {
  let org: Org;
  let dekA: Buffer;

  beforeAll(async () => {
    org = await createOrg();
    dekA = await storeCompanyKey(org, org.companyA);
  });

  const validEmbedding = () => toStoredEmbedding(encryptEmbedding(randomEmbedding(), dekA));

  it('uma chave ativa por empresa; versões antigas ficam inativas', async () => {
    const dup = toStoredCompanyKey(encryptDek(generateDek(), MASTER_KEY), 2);
    const insert = (active: boolean, version: number) =>
      client.query(
        `INSERT INTO rh.chaves_empresa (conta_id, empresa_id, versao_chave, dek_iv, dek_tag, dek_ct, eh_ativa)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [org.tenantId, org.companyA, version, dup.dekIv, dup.dekTag, dup.dekCt, active],
      );
    expect(await sqlState(insert(true, 2))).toBe('23505');
    expect(await sqlState(insert(false, 1))).toBe('23505'); // versão repetida
    await insert(false, 2);
  });

  it('chave com tamanho errado ou de empresa de outra conta é recusada', async () => {
    const good = toStoredCompanyKey(encryptDek(generateDek(), MASTER_KEY), 1);
    expect(
      await sqlState(
        client.query(
          `INSERT INTO rh.chaves_empresa (conta_id, empresa_id, versao_chave, dek_iv, dek_tag, dek_ct)
           VALUES ($1, $2, 1, $3, $4, $5)`,
          [org.tenantId, org.companyB, good.dekIv, good.dekTag, Buffer.alloc(16)],
        ),
      ),
    ).toBe('23514');
    const other = await createOrg();
    expect(
      await sqlState(
        client.query(
          `INSERT INTO rh.chaves_empresa (conta_id, empresa_id, versao_chave, dek_iv, dek_tag, dek_ct)
           VALUES ($1, $2, 1, $3, $4, $5)`,
          [other.tenantId, org.companyB, good.dekIv, good.dekTag, good.dekCt],
        ),
      ),
    ).toBe('23503');
  });

  it('sem consentimento, ou com consentimento de outra pessoa, não grava', async () => {
    const employeeId = await newEmployee(org);
    const otherEmployee = await newEmployee(org);
    const otherConsent = await newConsent(org, otherEmployee);
    expect(await sqlState(insertEmbedding(org, { employeeId, consentId: 999_999, companyId: org.companyA, stored: validEmbedding() }))).toBe(
      '23503',
    );
    expect(
      await sqlState(insertEmbedding(org, { employeeId, consentId: otherConsent, companyId: org.companyA, stored: validEmbedding() })),
    ).toBe('23503');
  });

  it('com consentimento revogado não grava', async () => {
    const employeeId = await newEmployee(org);
    const consentId = await newConsent(org, employeeId);
    await client.query("UPDATE rh.consentimentos_biometricos SET revogado_em = now(), motivo_revogacao = 'pedido do titular' WHERE id = $1", [
      consentId,
    ]);
    expect(await sqlState(insertEmbedding(org, { employeeId, consentId, companyId: org.companyA, stored: validEmbedding() }))).toBe('23514');
  });

  it('a chave precisa ser da empresa do colaborador', async () => {
    await storeCompanyKey(org, org.companyB);
    const employeeId = await newEmployee(org); // estabelecimento da empresa A
    const consentId = await newConsent(org, employeeId);
    expect(await sqlState(insertEmbedding(org, { employeeId, consentId, companyId: org.companyB, stored: validEmbedding() }))).toBe('23514');
  });

  it('tamanho errado e segundo embedding da mesma pessoa são recusados', async () => {
    const employeeId = await newEmployee(org);
    const consentId = await newConsent(org, employeeId);
    const short = { ...validEmbedding(), embeddingCt: Buffer.alloc(1024) };
    expect(await sqlState(insertEmbedding(org, { employeeId, consentId, companyId: org.companyA, stored: short }))).toBe('23514');
    await insertEmbedding(org, { employeeId, consentId, companyId: org.companyA, stored: validEmbedding() });
    expect(await sqlState(insertEmbedding(org, { employeeId, consentId, companyId: org.companyA, stored: validEmbedding() }))).toBe('23505');
  });

  it('um consentimento ativo por pessoa', async () => {
    const employeeId = await newEmployee(org);
    await newConsent(org, employeeId);
    expect(await sqlState(newConsent(org, employeeId))).toBe('23505');
  });

  it('revogar o consentimento apaga o rosto e mantém o consentimento como prova', async () => {
    const employeeId = await newEmployee(org);
    const consentId = await newConsent(org, employeeId);
    await insertEmbedding(org, { employeeId, consentId, companyId: org.companyA, stored: validEmbedding() });
    expect(
      await sqlState(client.query('UPDATE rh.consentimentos_biometricos SET revogado_em = now() WHERE id = $1', [consentId])),
    ).toBe('23514'); // revogação sem motivo
    await client.query("UPDATE rh.consentimentos_biometricos SET revogado_em = now(), motivo_revogacao = 'pedido do titular' WHERE id = $1", [
      consentId,
    ]);
    const left = await one<{ n: number }>('SELECT count(*)::int AS n FROM rh.embeddings_faciais WHERE colaborador_id = $1', [employeeId]);
    expect(left.n).toBe(0);
    const consent = await one<{ n: number }>('SELECT count(*)::int AS n FROM rh.consentimentos_biometricos WHERE id = $1', [consentId]);
    expect(consent.n).toBe(1);
    // depois da revogação, um novo consentimento permite recadastrar
    const again = await newConsent(org, employeeId);
    await insertEmbedding(org, { employeeId, consentId: again, companyId: org.companyA, stored: validEmbedding() });
  });
});
