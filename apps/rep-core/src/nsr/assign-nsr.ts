import type { Pool, PoolClient } from 'pg';
import { createLogger, roundMs, startTimer, type Clock, type Logger } from '@genus/shared';
import {
  computeRecordHash,
  GENESIS_HASH,
  HASH_FORMAT_VERSION,
  toHashTimestamp,
} from './hash.js';
import {
  DuplicateDeviceSequenceError,
  EntryFailedError,
  EntryNotFoundError,
  OutboxIncompleteError,
  SequenceTenantMismatchError,
} from './errors.js';
import { toSafeInt } from './safe-int.js';

export type AssignNsrOutcome = 'created' | 'already_processed';

export type OutboxEventName = 'generate-receipt-pdf' | 'recalculate-day' | 'official-qr';

/** Ordem de inserção e de devolução dos eventos (SPEC §5). */
export const OUTBOX_EVENTS: readonly OutboxEventName[] = [
  'generate-receipt-pdf',
  'recalculate-day',
  'official-qr',
];

export interface OutboxEventRef {
  outboxId: number;
  evento: OutboxEventName;
  chave: string;
}

export interface AssignNsrResult {
  outcome: AssignNsrOutcome;
  tenantId: number;
  establishmentId: number;
  nsr: number;
  outboxEvents: OutboxEventRef[];
  timings: { lockWaitMs: number; txMs: number };
}

export interface AssignNsrOptions {
  logger?: Logger;
}

/**
 * Constantes do registro tipo 7 sem fonte em `entradas` (SPEC §1).
 * [A CONFIRMAR] a API do coletor ainda não recebe lote offline nem outros tipos de coletor.
 */
const TIPO_REGISTRO = '7';
const TIPO_COLETOR = '01';
const EH_OFFLINE = false;

let defaultLogger: Logger | undefined;
function getDefaultLogger(): Logger {
  defaultLogger ??= createLogger({ level: 'info', service: 'rep-core' });
  return defaultLogger;
}

interface EntryRow {
  id: string;
  status: string;
  estabelecimento_id: string;
  aparelho_id: string;
  sequencia_aparelho: string;
  colaborador_id: string;
  cpf: string;
  /** Texto ISO UTC com milissegundos, calculado pelo banco (sem depender de conversão de Date). */
  marcado_em_ms: string;
  eh_hora_divergente: boolean;
  metodo_identificacao: string;
  nota_reconhecimento: number | null;
  nota_vivacidade: number | null;
}

interface OutboxRow {
  id: string;
  evento: OutboxEventName;
  chave: string;
}

function toEventRefs(rows: OutboxRow[]): OutboxEventRef[] {
  return [...rows]
    .sort((a, b) => OUTBOX_EVENTS.indexOf(a.evento) - OUTBOX_EVENTS.indexOf(b.evento))
    .map((r) => ({ outboxId: toSafeInt(r.id, 'outbox.id'), evento: r.evento, chave: r.chave }));
}

/**
 * Transforma uma `entradas` pendente em registro fiscal (NSR + hash encadeado) numa
 * única transação (docs/SPEC-nsr-fila.md §2 e §5). Ordem de travas FIXA:
 * entrada -> sequência do estabelecimento -> inserts. Sem I/O de rede dentro dela.
 * O UPDATE de `entradas` é o ÚLTIMO passo: o trigger do banco só aceita `processado`
 * com evidência e os 3 eventos de outbox já gravados.
 */
export async function assignNsr(
  pool: Pool,
  clock: Clock,
  input: { tenantId: number; entryId: number },
  options: AssignNsrOptions = {},
): Promise<AssignNsrResult> {
  const log = options.logger ?? getDefaultLogger();
  const { tenantId, entryId } = input;
  const elapsed = startTimer();
  const client = await pool.connect();
  // Conexão derrubada no meio da transação pode emitir 'error' no client; sem ouvinte
  // isso viraria exceção não tratada. O erro real chega pela rejeição da query.
  const onClientError = (err: Error): void => {
    // Sem err.message: o texto do driver pg pode citar host ou porta.
    log.warn({ entryId, err: { name: err.name, code: (err as { code?: string }).code } }, 'nsr_client_error');
  };
  client.on('error', onClientError);

  let destroyClient = false;
  try {
    await client.query('BEGIN');
    try {
      const result = await runTransaction(client, clock, tenantId, entryId, elapsed, log);
      await client.query('COMMIT');
      const txMs = roundMs(elapsed());
      const final: AssignNsrResult = {
        ...result,
        timings: { lockWaitMs: result.timings.lockWaitMs, txMs },
      };
      if (final.outcome === 'created') {
        log.info(
          {
            entryId,
            establishmentId: final.establishmentId,
            nsr: final.nsr,
            lockWaitMs: final.timings.lockWaitMs,
            txMs,
          },
          'nsr_assigned',
        );
      }
      return final;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        // Não esconde o erro original; a conexão está suspeita e é descartada.
        destroyClient = true;
        log.warn(
          { entryId, err: rollbackErr instanceof Error ? rollbackErr.message : 'erro' },
          'nsr_rollback_failed',
        );
      }
      throw err;
    }
  } catch (err) {
    // Falha em BEGIN/COMMIT (conexão perdida): o client não serve mais.
    if (err instanceof Error && /terminat|connection|ECONN|EPIPE/i.test(err.message)) {
      destroyClient = true;
    }
    throw err;
  } finally {
    client.off('error', onClientError);
    client.release(destroyClient ? true : undefined);
  }
}

async function runTransaction(
  client: PoolClient,
  clock: Clock,
  tenantId: number,
  entryId: number,
  elapsed: () => number,
  log: Logger,
): Promise<AssignNsrResult> {
  // 1. Trava a entrada. `conta_id` no WHERE: entrada de outra conta é "não encontrada".
  const entrySel = await client.query<EntryRow>(
    `SELECT id, status, estabelecimento_id, aparelho_id, sequencia_aparelho, colaborador_id, cpf,
            to_char(date_trunc('milliseconds', marcado_em) AT TIME ZONE 'UTC',
                    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS marcado_em_ms,
            eh_hora_divergente, metodo_identificacao, nota_reconhecimento, nota_vivacidade
       FROM entradas
      WHERE id = $1 AND conta_id = $2
        FOR UPDATE`,
    [entryId, tenantId],
  );
  const lockWaitMs = roundMs(elapsed());
  const entry = entrySel.rows[0];
  if (!entry) throw new EntryNotFoundError(tenantId, entryId);

  const establishmentId = toSafeInt(entry.estabelecimento_id, 'entradas.estabelecimento_id');
  const deviceId = toSafeInt(entry.aparelho_id, 'entradas.aparelho_id');
  const deviceSequence = toSafeInt(entry.sequencia_aparelho, 'entradas.sequencia_aparelho');

  // 2. Já processada: devolve o NSR existente, sem escrever nada.
  if (entry.status === 'processado') {
    return readAlreadyProcessed(client, tenantId, entryId, establishmentId, lockWaitMs);
  }
  if (entry.status === 'falhou') {
    log.warn({ entryId }, 'nsr_entry_failed_skipped');
    throw new EntryFailedError(entryId);
  }

  // 3. A UNIQUE (aparelho, sequência) de `evidencias` é a defesa final; aqui só
  // damos um erro claro (e não recuperável) em vez de uma violação de constraint.
  const dup = await client.query<{ entrada_id: string }>(
    `SELECT entrada_id FROM evidencias
      WHERE aparelho_id = $1 AND sequencia_aparelho = $2 AND conta_id = $3 AND entrada_id <> $4`,
    [deviceId, deviceSequence, tenantId, entryId],
  );
  if (dup.rows[0]) {
    const other = toSafeInt(dup.rows[0].entrada_id, 'evidencias.entrada_id');
    log.error({ entryId, otherEntryId: other, deviceId, deviceSequence }, 'nsr_duplicate_device_sequence');
    throw new DuplicateDeviceSequenceError(entryId, other);
  }

  // 4. Garante a linha da sequência e trava por estabelecimento.
  await client.query(
    `INSERT INTO sequencias_estabelecimento (estabelecimento_id, conta_id, ultimo_nsr, ultimo_hash)
     VALUES ($1, $2, 0, NULL)
     ON CONFLICT DO NOTHING`,
    [establishmentId, tenantId],
  );
  const seqSel = await client.query<{
    ultimo_nsr: string;
    ultimo_hash: Buffer | null;
    conta_id: string;
  }>(
    `SELECT ultimo_nsr, ultimo_hash, conta_id
       FROM sequencias_estabelecimento
      WHERE estabelecimento_id = $1
        FOR UPDATE`,
    [establishmentId],
  );
  const seq = seqSel.rows[0];
  if (!seq) throw new Error(`Sequência do estabelecimento ${establishmentId} não encontrada após o INSERT`);
  if (toSafeInt(seq.conta_id, 'sequencias_estabelecimento.conta_id') !== tenantId) {
    log.error({ entryId, establishmentId }, 'nsr_sequence_tenant_mismatch');
    throw new SequenceTenantMismatchError(establishmentId);
  }

  // 5. NSR e hash. `ultimo_hash` nulo = primeiro registro (genesis).
  const nsr = toSafeInt(seq.ultimo_nsr, 'sequencias_estabelecimento.ultimo_nsr') + 1;
  const previousHash = seq.ultimo_hash ?? GENESIS_HASH;
  const gravadoEm = toHashTimestamp(clock.now());
  const marcadoEm = entry.marcado_em_ms;
  const hash = computeRecordHash(
    {
      nsr,
      tipo: TIPO_REGISTRO,
      marcadoEm,
      cpf: entry.cpf,
      gravadoEm,
      tipoColetor: TIPO_COLETOR,
      ehOffline: EH_OFFLINE,
    },
    previousHash,
  );

  // 6. Registro fiscal. `marcado_em` é o MESMO texto (ms) que entrou no hash.
  await client.query(
    `INSERT INTO registros (estabelecimento_id, nsr, conta_id, tipo, cpf, marcado_em, gravado_em,
                            tipo_coletor, eh_offline, hash, hash_anterior, versao_formato_hash)
     VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz, $8, $9, $10, $11, $12)`,
    [
      establishmentId,
      nsr,
      tenantId,
      TIPO_REGISTRO,
      entry.cpf,
      marcadoEm,
      gravadoEm,
      TIPO_COLETOR,
      EH_OFFLINE,
      hash,
      previousHash,
      HASH_FORMAT_VERSION,
    ],
  );

  // 7. Evidência.
  await client.query(
    `INSERT INTO evidencias (estabelecimento_id, nsr, conta_id, entrada_id, aparelho_id, sequencia_aparelho,
                             colaborador_id, metodo_identificacao, nota_reconhecimento, nota_vivacidade,
                             eh_hora_divergente)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      establishmentId,
      nsr,
      tenantId,
      entryId,
      deviceId,
      deviceSequence,
      toSafeInt(entry.colaborador_id, 'entradas.colaborador_id'),
      entry.metodo_identificacao,
      entry.nota_reconhecimento,
      entry.nota_vivacidade,
      entry.eh_hora_divergente,
    ],
  );

  // 8. Avança a sequência (o trigger cuida de `atualizado_em`).
  await client.query(
    `UPDATE sequencias_estabelecimento SET ultimo_nsr = $1, ultimo_hash = $2
      WHERE estabelecimento_id = $3 AND conta_id = $4`,
    [nsr, hash, establishmentId, tenantId],
  );

  // 9. Os 3 eventos do outbox, num único INSERT (ordem de OUTBOX_EVENTS).
  const chave = `${establishmentId}-${nsr}`;
  const payload = JSON.stringify({ establishmentId, nsr });
  const outboxIns = await client.query<OutboxRow>(
    `INSERT INTO outbox (conta_id, estabelecimento_id, evento, chave, payload)
     SELECT $1::bigint, $2::bigint, ev, $3::text, $4::jsonb FROM unnest($5::text[]) AS ev
     ON CONFLICT DO NOTHING
     RETURNING id, evento, chave`,
    [tenantId, establishmentId, chave, payload, [...OUTBOX_EVENTS]],
  );
  if (outboxIns.rows.length !== OUTBOX_EVENTS.length) {
    log.error({ entryId, establishmentId, nsr, inserted: outboxIns.rows.length }, 'nsr_outbox_incomplete');
    throw new OutboxIncompleteError(
      entryId,
      `apenas ${outboxIns.rows.length} de ${OUTBOX_EVENTS.length} eventos gravados para ${chave}`,
    );
  }

  // 10. POR ÚLTIMO: o trigger confere evidência + 3 eventos antes de aceitar 'processado'.
  await client.query(
    `UPDATE entradas SET status = 'processado', processado_em = $1::timestamptz
      WHERE id = $2 AND conta_id = $3`,
    [toHashTimestamp(clock.now()), entryId, tenantId],
  );

  return {
    outcome: 'created',
    tenantId,
    establishmentId,
    nsr,
    outboxEvents: toEventRefs(outboxIns.rows),
    timings: { lockWaitMs, txMs: 0 },
  };
}

async function readAlreadyProcessed(
  client: PoolClient,
  tenantId: number,
  entryId: number,
  establishmentId: number,
  lockWaitMs: number,
): Promise<AssignNsrResult> {
  const ev = await client.query<{ nsr: string; estabelecimento_id: string }>(
    `SELECT estabelecimento_id, nsr FROM evidencias WHERE entrada_id = $1 AND conta_id = $2`,
    [entryId, tenantId],
  );
  const evidence = ev.rows[0];
  if (!evidence) throw new OutboxIncompleteError(entryId, 'sem evidência');
  const nsr = toSafeInt(evidence.nsr, 'evidencias.nsr');
  const evidenceEstablishment = toSafeInt(evidence.estabelecimento_id, 'evidencias.estabelecimento_id');
  if (evidenceEstablishment !== establishmentId) {
    throw new OutboxIncompleteError(entryId, 'evidência de outro estabelecimento');
  }
  const chave = `${establishmentId}-${nsr}`;
  const events = await client.query<OutboxRow>(
    `SELECT id, evento, chave FROM outbox
      WHERE conta_id = $1 AND estabelecimento_id = $2 AND chave = $3 AND evento = ANY($4::text[])`,
    [tenantId, establishmentId, chave, [...OUTBOX_EVENTS]],
  );
  if (events.rows.length !== OUTBOX_EVENTS.length) {
    throw new OutboxIncompleteError(
      entryId,
      `${events.rows.length} de ${OUTBOX_EVENTS.length} eventos de outbox para ${chave}`,
    );
  }
  return {
    outcome: 'already_processed',
    tenantId,
    establishmentId,
    nsr,
    outboxEvents: toEventRefs(events.rows),
    timings: { lockWaitMs, txMs: 0 },
  };
}
