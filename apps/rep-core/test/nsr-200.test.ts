import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startArpTestDatabase, type ArpTestDatabase } from '@genus/db-arp';
import { createLogger } from '@genus/shared';
import { assignNsr } from '../src/nsr/assign-nsr';
import { checkProcessedInvariant } from '../src/nsr/check-invariant';
import { readChain } from '../src/nsr/read-chain';
import { verifyChain } from '../src/nsr/verify-chain';
import {
  independentChain,
  readRawRegistros,
  runQueue,
  scalar,
  seedEntries,
  shuffle,
  TickingClock,
} from './support/arp-fixtures';

const ROUNDS = Number(process.env.NSR_STRESS_ROUNDS ?? 5);
const ENTRIES = 200;
const logger = createLogger({ level: 'silent', service: 'rep-core-test' });

let db: ArpTestDatabase;
let core: pg.Pool;
let reader: pg.Pool;
let owner: pg.Pool;

beforeAll(async () => {
  db = await startArpTestDatabase();
  core = new pg.Pool({ connectionString: db.coreUrl, max: 25 });
  reader = new pg.Pool({ connectionString: db.readerUrl, max: 2 });
  owner = new pg.Pool({ connectionString: db.ownerUrl, max: 2 });
});

afterAll(async () => {
  await Promise.all([core?.end(), reader?.end(), owner?.end()]);
  await db?.stop();
});

describe('NSR sob concorrência (200 batidas, mesmo estabelecimento)', () => {
  for (let round = 1; round <= ROUNDS; round++) {
    it(`rodada ${round}/${ROUNDS}: NSR 1..200 sem buraco, cadeia íntegra`, async () => {
      const establishmentId = 5000 + round;
      const tenantId = 1;
      const ids = await seedEntries(db.collectorUrl, {
        tenantId,
        establishmentId,
        deviceId: 9000 + round,
        count: ENTRIES,
      });
      expect(ids).toHaveLength(ENTRIES);

      const clock = new TickingClock();
      const concurrency = 8 + Math.floor(Math.random() * 18); // 8..25
      const results = await runQueue(shuffle(ids), concurrency, (entryId) =>
        assignNsr(core, clock, { tenantId, entryId }, { logger }),
      );

      // (i) NSR exatamente {1..200}, sem repetição; todas 'created'.
      const nsrs = results.map((r) => r.nsr).sort((a, b) => a - b);
      expect(nsrs).toEqual(Array.from({ length: ENTRIES }, (_, i) => i + 1));
      expect(results.every((r) => r.outcome === 'created' && r.outboxEvents.length === 3)).toBe(true);

      // (ii) verificador oficial.
      const rows = await readChain(reader, { tenantId, establishmentId });
      const report = verifyChain(rows);
      expect(report.errors).toEqual([]);
      expect(report.warnings).toEqual([]);
      expect(report.ok).toBe(true);
      expect(report.rowsChecked).toBe(ENTRIES);

      // (iii) recálculo independente (sem computeRecordHash) bate linha a linha.
      const raw = await readRawRegistros(owner, establishmentId);
      const expected = independentChain(raw);
      expect(raw).toHaveLength(ENTRIES);
      raw.forEach((r, i) => {
        expect(r.hash.equals(expected[i]!)).toBe(true);
      });

      // (iv) sequência = (200, hash do último NSR).
      const seq = await owner.query<{ ultimo_nsr: string; ultimo_hash: Buffer }>(
        'SELECT ultimo_nsr, ultimo_hash FROM sequencias_estabelecimento WHERE estabelecimento_id = $1',
        [establishmentId],
      );
      expect(Number(seq.rows[0]!.ultimo_nsr)).toBe(ENTRIES);
      expect(seq.rows[0]!.ultimo_hash.equals(raw[ENTRIES - 1]!.hash)).toBe(true);

      // (v) contagens.
      expect(await scalar(owner, 'SELECT count(*) AS n FROM evidencias WHERE estabelecimento_id = $1', [establishmentId])).toBe(ENTRIES);
      expect(await scalar(owner, 'SELECT count(*) AS n FROM outbox WHERE estabelecimento_id = $1', [establishmentId])).toBe(ENTRIES * 3);
      expect(
        await scalar(owner, 'SELECT count(*) AS n FROM (SELECT DISTINCT evento, chave FROM outbox WHERE estabelecimento_id = $1) d', [establishmentId]),
      ).toBe(ENTRIES * 3);
      expect(
        await scalar(owner, "SELECT count(*) AS n FROM entradas WHERE estabelecimento_id = $1 AND status = 'processado'", [establishmentId]),
      ).toBe(ENTRIES);
      expect(await checkProcessedInvariant(reader, { tenantId, establishmentId })).toEqual([]);
    });
  }
});
