import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startArpTestDatabase, type ArpTestDatabase } from '@genus/db-arp';
import { createLogger, FixedClock } from '@genus/shared';
import { assignNsr } from '../src/nsr/assign-nsr';
import { EntryNotFoundError, isRecoverable, SequenceTenantMismatchError } from '../src/nsr/errors';
import { readChain } from '../src/nsr/read-chain';
import { verifyChain } from '../src/nsr/verify-chain';
import { runQueue, scalar, seedEntries, shuffle, TickingClock } from './support/arp-fixtures';

const logger = createLogger({ level: 'silent', service: 'rep-core-test' });

let db: ArpTestDatabase;
let core: pg.Pool;
let reader: pg.Pool;
let owner: pg.Pool;
let nextEstablishment = 100;

beforeAll(async () => {
  db = await startArpTestDatabase();
  core = new pg.Pool({ connectionString: db.coreUrl, max: 20 });
  reader = new pg.Pool({ connectionString: db.readerUrl, max: 2 });
  owner = new pg.Pool({ connectionString: db.ownerUrl, max: 2 });
});

afterAll(async () => {
  await Promise.all([core?.end(), reader?.end(), owner?.end()]);
  await db?.stop();
});

/** Estabelecimento e aparelho novos por teste: nada se mistura. */
function fresh(): { establishmentId: number; deviceId: number } {
  nextEstablishment += 1;
  return { establishmentId: nextEstablishment, deviceId: nextEstablishment + 10000 };
}

async function counts(establishmentId: number) {
  return {
    registros: await scalar(owner, 'SELECT count(*) AS n FROM registros WHERE estabelecimento_id = $1', [establishmentId]),
    evidencias: await scalar(owner, 'SELECT count(*) AS n FROM evidencias WHERE estabelecimento_id = $1', [establishmentId]),
    outbox: await scalar(owner, 'SELECT count(*) AS n FROM outbox WHERE estabelecimento_id = $1', [establishmentId]),
    processadas: await scalar(
      owner,
      "SELECT count(*) AS n FROM entradas WHERE estabelecimento_id = $1 AND status = 'processado'",
      [establishmentId],
    ),
  };
}

async function expectNothingPersisted(establishmentId: number, entryId: number) {
  expect(await counts(establishmentId)).toEqual({ registros: 0, evidencias: 0, outbox: 0, processadas: 0 });
  const e = await owner.query<{ status: string; tentativas: number }>(
    'SELECT status, tentativas FROM entradas WHERE id = $1',
    [entryId],
  );
  expect(e.rows[0]).toEqual({ status: 'pendente', tentativas: 0 });
}

/** Cria um trigger de teste como arp_owner e garante a remoção. */
async function withInjectedFailure(
  sql: { create: string; drop: string },
  body: () => Promise<void>,
): Promise<void> {
  await owner.query(sql.create);
  try {
    await body();
  } finally {
    await owner.query(sql.drop);
  }
}

describe('assignNsr: variantes', () => {
  it('a mesma entrada 10 vezes em paralelo gera 1 registro, 1 evidência e 3 eventos', async () => {
    const { establishmentId, deviceId } = fresh();
    const [entryId] = await seedEntries(db.collectorUrl, { tenantId: 1, establishmentId, deviceId, count: 1 });
    const clock = new TickingClock();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => assignNsr(core, clock, { tenantId: 1, entryId: entryId! }, { logger })),
    );
    expect(results.filter((r) => r.outcome === 'created')).toHaveLength(1);
    expect(results.filter((r) => r.outcome === 'already_processed')).toHaveLength(9);
    expect(new Set(results.map((r) => r.nsr))).toEqual(new Set([1]));
    const ids = new Set(results.map((r) => r.outboxEvents.map((e) => e.outboxId).join(',')));
    expect(ids.size).toBe(1); // todos devolvem os MESMOS 3 eventos
    expect(await counts(establishmentId)).toEqual({ registros: 1, evidencias: 1, outbox: 3, processadas: 1 });
  });

  it('3 estabelecimentos intercalados: NSR 1..n e cadeia próprios', async () => {
    const sizes = [30, 45, 25];
    const setups = await Promise.all(
      sizes.map(async (count) => {
        const f = fresh();
        const ids = await seedEntries(db.collectorUrl, { tenantId: 1, establishmentId: f.establishmentId, deviceId: f.deviceId, count });
        return { ...f, ids };
      }),
    );
    const tasks = shuffle(setups.flatMap((s) => s.ids));
    const clock = new TickingClock();
    await runQueue(tasks, 15, (entryId) => assignNsr(core, clock, { tenantId: 1, entryId }, { logger }));
    for (const [i, s] of setups.entries()) {
      const rows = await readChain(reader, { tenantId: 1, establishmentId: s.establishmentId });
      expect(rows.map((r) => r.nsr)).toEqual(Array.from({ length: sizes[i]! }, (_, k) => k + 1));
      const report = verifyChain(rows);
      expect(report.errors).toEqual([]);
      expect(report.ok).toBe(true);
    }
  });

  it('falha injetada no INSERT do outbox: nada persiste e o NSR não é consumido', async () => {
    const { establishmentId, deviceId } = fresh();
    const [entryId] = await seedEntries(db.collectorUrl, { tenantId: 1, establishmentId, deviceId, count: 1 });
    const clock = new TickingClock();
    await withInjectedFailure(
      {
        create: `
          CREATE FUNCTION teste_falha_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN
            IF NEW.evento = 'recalculate-day' AND NEW.estabelecimento_id = ${establishmentId} THEN
              RAISE EXCEPTION 'falha injetada no outbox';
            END IF;
            RETURN NEW;
          END $$;
          CREATE TRIGGER trg_teste_falha_outbox BEFORE INSERT ON outbox
            FOR EACH ROW EXECUTE FUNCTION teste_falha_outbox();`,
        drop: 'DROP TRIGGER IF EXISTS trg_teste_falha_outbox ON outbox; DROP FUNCTION IF EXISTS teste_falha_outbox();',
      },
      async () => {
        const err = await assignNsr(core, clock, { tenantId: 1, entryId: entryId! }, { logger }).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toContain('falha injetada no outbox');
        expect(isRecoverable(err)).toBe(true);
        await expectNothingPersisted(establishmentId, entryId!);
        // O NSR não foi consumido: a sequência nem existe (o INSERT dela foi revertido).
        expect(await scalar(owner, 'SELECT count(*) AS n FROM sequencias_estabelecimento WHERE estabelecimento_id = $1', [establishmentId])).toBe(0);
      },
    );
    const ok = await assignNsr(core, clock, { tenantId: 1, entryId: entryId! }, { logger });
    expect(ok.nsr).toBe(1);
    expect(ok.outcome).toBe('created');
  });

  it('falha injetada depois do INSERT em registros: nada persiste e o NSR não é consumido', async () => {
    const { establishmentId, deviceId } = fresh();
    const [entryId] = await seedEntries(db.collectorUrl, { tenantId: 1, establishmentId, deviceId, count: 1 });
    const clock = new TickingClock();
    // AFTER INSERT em evidencias: roda depois do INSERT em registros (a FK exige o registro antes).
    await withInjectedFailure(
      {
        create: `
          CREATE FUNCTION teste_falha_evidencia() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN
            IF NEW.estabelecimento_id = ${establishmentId} THEN
              RAISE EXCEPTION 'falha injetada na evidencia';
            END IF;
            RETURN NEW;
          END $$;
          CREATE TRIGGER trg_teste_falha_evidencia AFTER INSERT ON evidencias
            FOR EACH ROW EXECUTE FUNCTION teste_falha_evidencia();`,
        drop: 'DROP TRIGGER IF EXISTS trg_teste_falha_evidencia ON evidencias; DROP FUNCTION IF EXISTS teste_falha_evidencia();',
      },
      async () => {
        await expect(assignNsr(core, clock, { tenantId: 1, entryId: entryId! }, { logger })).rejects.toThrow(
          /falha injetada na evidencia/,
        );
        await expectNothingPersisted(establishmentId, entryId!);
      },
    );
    expect((await assignNsr(core, clock, { tenantId: 1, entryId: entryId! }, { logger })).nsr).toBe(1);
  });

  it('pg_terminate_backend no meio: a transação é revertida e o NSR seguinte é 1', async () => {
    const { establishmentId, deviceId } = fresh();
    const [entryId] = await seedEntries(db.collectorUrl, { tenantId: 1, establishmentId, deviceId, count: 1 });
    const clock = new TickingClock();
    // Pool próprio: a conexão derrubada não envenena o pool dos outros testes.
    const fragile = new pg.Pool({ connectionString: db.coreUrl, max: 2 });
    fragile.on('error', () => undefined);
    try {
      await withInjectedFailure(
        {
          create: `
            CREATE FUNCTION teste_derruba_sessao() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
              IF NEW.evento = 'official-qr' AND NEW.estabelecimento_id = ${establishmentId} THEN
                PERFORM pg_terminate_backend(pg_backend_pid());
              END IF;
              RETURN NEW;
            END $$;
            CREATE TRIGGER trg_teste_derruba_sessao AFTER INSERT ON outbox
              FOR EACH ROW EXECUTE FUNCTION teste_derruba_sessao();`,
          drop: 'DROP TRIGGER IF EXISTS trg_teste_derruba_sessao ON outbox; DROP FUNCTION IF EXISTS teste_derruba_sessao();',
        },
        async () => {
          const err = await assignNsr(fragile, clock, { tenantId: 1, entryId: entryId! }, { logger }).catch((e: unknown) => e);
          expect(err).toBeInstanceOf(Error);
          expect(isRecoverable(err)).toBe(true);
          await expectNothingPersisted(establishmentId, entryId!);
        },
      );
      // O mesmo pool volta a funcionar (a conexão morta foi descartada, não devolvida).
      const ok = await assignNsr(fragile, clock, { tenantId: 1, entryId: entryId! }, { logger });
      expect(ok.nsr).toBe(1);
    } finally {
      await fragile.end();
    }
  });

  it('conta divergente: entrada da conta 2 com tenantId 1 é "não encontrada" e nada é escrito', async () => {
    const { establishmentId, deviceId } = fresh();
    const [entryId] = await seedEntries(db.collectorUrl, { tenantId: 2, establishmentId, deviceId, count: 1 });
    const err = await assignNsr(core, new TickingClock(), { tenantId: 1, entryId: entryId! }, { logger }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EntryNotFoundError);
    expect(isRecoverable(err)).toBe(false);
    await expectNothingPersisted(establishmentId, entryId!);
    expect(await scalar(owner, 'SELECT count(*) AS n FROM sequencias_estabelecimento WHERE estabelecimento_id = $1', [establishmentId])).toBe(0);
  });

  it('sequência de outra conta no mesmo estabelecimento: erro não recuperável e nada é escrito', async () => {
    const { establishmentId, deviceId } = fresh();
    // Sequência pré-existente da conta 2 (o rep-core pode inserir nela).
    await core.query(
      'INSERT INTO sequencias_estabelecimento (estabelecimento_id, conta_id, ultimo_nsr) VALUES ($1, 2, 0)',
      [establishmentId],
    );
    const [entryId] = await seedEntries(db.collectorUrl, { tenantId: 1, establishmentId, deviceId, count: 1 });
    const err = await assignNsr(core, new TickingClock(), { tenantId: 1, entryId: entryId! }, { logger }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SequenceTenantMismatchError);
    expect(isRecoverable(err)).toBe(false);
    await expectNothingPersisted(establishmentId, entryId!);
  });

  it('microssegundos em marcado_em: o registro grava em ms e a cadeia verifica', async () => {
    const { establishmentId, deviceId } = fresh();
    const [entryId] = await seedEntries(db.collectorUrl, {
      tenantId: 1,
      establishmentId,
      deviceId,
      count: 1,
      markedAt: () => '2026-11-20 12:00:00.123456+00',
    });
    const clock = new FixedClock('2026-11-20T13:00:00.456Z');
    const r = await assignNsr(core, clock, { tenantId: 1, entryId: entryId! }, { logger });
    expect(r.nsr).toBe(1);
    const rows = await readChain(reader, { tenantId: 1, establishmentId });
    expect(rows[0]!.marcadoEm).toBe('2026-11-20T12:00:00.123000Z');
    expect(rows[0]!.gravadoEm).toBe('2026-11-20T13:00:00.456000Z');
    expect(verifyChain(rows).ok).toBe(true);
  });

  it('registro com microssegundos em gravado_em (inserido pelo arp_core) é corrupção na leitura real', async () => {
    const { establishmentId } = fresh();
    // O banco não impede (só o rep-core garante ms); o verificador é quem pega.
    await core.query(
      `INSERT INTO registros (estabelecimento_id, nsr, conta_id, tipo, cpf, marcado_em, gravado_em,
                              tipo_coletor, eh_offline, hash, hash_anterior, versao_formato_hash)
       VALUES ($1, 1, 1, '7', '12345678901', '2026-11-20 12:00:00.123+00', '2026-11-20 12:00:01.123456+00',
               '01', false, $2, $3, 1)`,
      [establishmentId, Buffer.alloc(32, 1), Buffer.alloc(32)],
    );
    const rows = await readChain(reader, { tenantId: 1, establishmentId });
    expect(rows[0]!.gravadoEm).toBe('2026-11-20T12:00:01.123456Z');
    const report = verifyChain(rows);
    expect(report.ok).toBe(false);
    expect(report.errors.some((e) => e.includes('gravado_em'))).toBe(true);
  });
});
