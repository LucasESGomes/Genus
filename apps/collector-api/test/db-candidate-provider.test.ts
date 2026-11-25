import { startArpTestDatabase, type ArpTestDatabase } from '@genus/db-arp';
import {
  createLogger,
  decryptDek,
  decryptEmbedding,
  ENGINE_MAX_CANDIDATES,
  FixedClock,
  type DeviceContext,
} from '@genus/shared';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateFakeCpf } from '../src/candidates/cpf';
import { DbCandidateProvider } from '../src/candidates/db-candidate-provider';
import { createAppTestDatabase, seedCompanyKey, seedEmployee, type AppTestDatabase } from './support/app-db';
import { MASTER_KEY, memoryLog } from './support/harness';

let arp: ArpTestDatabase;
let app: AppTestDatabase;
let reader: pg.Pool;
const clock = new FixedClock('2026-11-25T15:00:00.000Z');
const ctx: DeviceContext = { tenantId: 1, establishmentId: 10, deviceId: 100 };

beforeAll(async () => {
  arp = await startArpTestDatabase();
  app = await createAppTestDatabase(arp);
  reader = new pg.Pool({ connectionString: app.readerUrl, max: 2 });
}, 120_000);

afterAll(async () => {
  await reader?.end();
  await app?.stop();
  await arp?.stop();
});

beforeEach(async () => {
  await app.admin.query('TRUNCATE rh.colaboradores, rh.embeddings_faciais, rh.chaves_empresa');
});

function provider(maxCandidates?: number) {
  const log = memoryLog();
  const logger = createLogger({ level: 'debug', service: 'test', destination: log.destination });
  return { log, provider: new DbCandidateProvider({ pool: reader, clock, logger, maxCandidates }) };
}

let cpfSeq = 0;
const cpf = () => generateFakeCpf(++cpfSeq);

describe('DbCandidateProvider', () => {
  it('devolve só colaboradores ativos do estabelecimento do aparelho, com rosto, no formato da engine', async () => {
    const dek = await seedCompanyKey(app, { tenantId: 1, companyId: 5, version: 1, masterKeyHex: MASTER_KEY });
    const face = { dek, companyId: 5, version: 1 };
    const ana = await seedEmployee(app, { tenantId: 1, establishmentId: 10, cpf: cpf(), name: 'Ana', face });
    const bia = await seedEmployee(app, {
      tenantId: 1,
      establishmentId: 10,
      cpf: cpf(),
      name: 'Bia',
      face,
      terminationDate: '2026-11-25',
    });
    await seedEmployee(app, { tenantId: 1, establishmentId: 10, cpf: cpf(), name: 'Desligada', face, terminationDate: '2026-11-24' });
    await seedEmployee(app, { tenantId: 1, establishmentId: 10, cpf: cpf(), name: 'Sem rosto' });
    await seedEmployee(app, { tenantId: 1, establishmentId: 11, cpf: cpf(), name: 'Outro estabelecimento', face });
    await seedEmployee(app, { tenantId: 2, establishmentId: 10, cpf: cpf(), name: 'Outra conta', face });

    const set = await provider().provider.getCandidates(ctx);

    expect(set.candidates.map((c) => c.displayName)).toEqual(['Ana', 'Bia']);
    expect(set.candidates.map((c) => c.employeeId)).toEqual([ana, bia]);
    // A DEK devolvida decifra com a MASTER_KEY e abre todos os embeddings.
    const clear = decryptDek(set.tenantDek, MASTER_KEY);
    expect(clear.equals(dek)).toBe(true);
    for (const c of set.candidates) {
      expect(c.cpf).toMatch(/^\d{11}$/);
      expect(c.embedding.ivHex).toHaveLength(24);
      expect(c.embedding.tagHex).toHaveLength(32);
      expect(decryptEmbedding(c.embedding, clear)).toHaveLength(512);
    }
  });

  it('sem ninguém com rosto: lista vazia (a batida vira fallback, sem chamar a engine)', async () => {
    await seedEmployee(app, { tenantId: 1, establishmentId: 10, cpf: cpf(), name: 'Sem rosto' });
    const set = await provider().provider.getCandidates(ctx);
    expect(set.candidates).toEqual([]);
  });

  it('usa só a DEK ativa: embeddings da chave antiga ficam de fora, com aviso só de contagem', async () => {
    const oldDek = await seedCompanyKey(app, {
      tenantId: 1,
      companyId: 5,
      version: 1,
      masterKeyHex: MASTER_KEY,
      active: false,
    });
    const newDek = await seedCompanyKey(app, { tenantId: 1, companyId: 5, version: 2, masterKeyHex: MASTER_KEY });
    await seedEmployee(app, {
      tenantId: 1,
      establishmentId: 10,
      cpf: cpf(),
      name: 'Nova',
      face: { dek: newDek, companyId: 5, version: 2 },
    });
    await seedEmployee(app, {
      tenantId: 1,
      establishmentId: 10,
      cpf: cpf(),
      name: 'Antiga',
      face: { dek: oldDek, companyId: 5, version: 1 },
    });

    const { provider: p, log } = provider();
    const set = await p.getCandidates(ctx);
    expect(set.candidates.map((c) => c.displayName)).toEqual(['Nova']);
    expect(decryptDek(set.tenantDek, MASTER_KEY).equals(newDek)).toBe(true);
    const warn = log.records().find((r) => r.event === 'candidates_trimmed');
    expect(warn).toMatchObject({ skippedOldKey: 1, used: 1 });
  });

  it('acima do teto: corta nos primeiros e avisa só a contagem (sem CPF nem nome)', async () => {
    const dek = await seedCompanyKey(app, { tenantId: 1, companyId: 5, version: 1, masterKeyHex: MASTER_KEY });
    for (let i = 0; i < 5; i++) {
      await seedEmployee(app, {
        tenantId: 1,
        establishmentId: 10,
        cpf: cpf(),
        name: `Pessoa ${i}`,
        face: { dek, companyId: 5, version: 1 },
      });
    }
    const { provider: p, log } = provider(3);
    const set = await p.getCandidates(ctx);
    expect(set.candidates).toHaveLength(3);
    const warn = log.records().find((r) => r.event === 'candidates_trimmed');
    expect(warn).toMatchObject({ overCap: true, used: 3, max: 3 });
    expect(log.text()).not.toMatch(/Pessoa|\d{11}/);
  });

  it('o teto nunca passa de ENGINE_MAX_CANDIDATES', async () => {
    const dek = await seedCompanyKey(app, { tenantId: 1, companyId: 5, version: 1, masterKeyHex: MASTER_KEY });
    await seedEmployee(app, { tenantId: 1, establishmentId: 10, cpf: cpf(), name: 'Um', face: { dek, companyId: 5, version: 1 } });
    const { provider: p } = provider(10_000);
    expect((await p.getCandidates(ctx)).candidates).toHaveLength(1);
    expect(ENGINE_MAX_CANDIDATES).toBe(240);
  });
});
