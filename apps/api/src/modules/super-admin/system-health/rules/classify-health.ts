/**
 * Classificadores puros da saúde da plataforma. Os limites abaixo são operacionais (não são regra
 * legal) e ficam aqui, nomeados, para o painel e os testes concordarem.
 */
export type HealthState = 'ok' | 'degraded' | 'down';

const RANK: Record<HealthState, number> = { ok: 0, degraded: 1, down: 2 };

/** Pior estado da lista (`ok` se vazia). */
export function worstOf(states: readonly HealthState[]): HealthState {
  return states.reduce<HealthState>((worst, s) => (RANK[s] > RANK[worst] ? s : worst), 'ok');
}

/** Sonda (banco, Valkey, engine, coletor) que responde, mas devagar, fica `degraded`. */
export const PROBE_SLOW_MS = 1000;

export function classifyLatency(latencyMs: number): HealthState {
  return latencyMs > PROBE_SLOW_MS ? 'degraded' : 'ok';
}

/**
 * rep-core: o resgate (apps/jobs) republica `entradas` pendentes há mais de 30 s, então uma
 * pendência de mais de 60 s já indica que o worker não está consumindo.
 */
export const REP_CORE_DEGRADED_AGE_S = 60;
export const REP_CORE_DOWN_AGE_S = 600;
/** Fila `punches` com mais de 500 jobs esperando. */
export const REP_CORE_DEGRADED_WAITING = 500;

/** jobs (pós-batida): eventos do outbox pendentes há mais de 120 s / 900 s. */
export const JOBS_DEGRADED_AGE_S = 120;
export const JOBS_DOWN_AGE_S = 900;
/** Fila `post-punch` com mais de 2000 jobs esperando. */
export const JOBS_DEGRADED_WAITING = 2000;

export interface BacklogInput {
  /** Idade (s) da pendência mais antiga no arp; null = nada pendente. */
  oldestPendingAgeSeconds: number | null;
  /** Jobs esperando na fila; null = fila não consultada. */
  waiting: number | null;
}

function classifyBacklog(i: BacklogInput, degradedAge: number, downAge: number, degradedWaiting: number): HealthState {
  const age = i.oldestPendingAgeSeconds;
  if (age !== null && age > downAge) return 'down';
  if (age !== null && age > degradedAge) return 'degraded';
  if (i.waiting !== null && i.waiting > degradedWaiting) return 'degraded';
  return 'ok';
}

export const classifyRepCore = (i: BacklogInput): HealthState =>
  classifyBacklog(i, REP_CORE_DEGRADED_AGE_S, REP_CORE_DOWN_AGE_S, REP_CORE_DEGRADED_WAITING);

export const classifyJobs = (i: BacklogInput): HealthState =>
  classifyBacklog(i, JOBS_DEGRADED_AGE_S, JOBS_DOWN_AGE_S, JOBS_DEGRADED_WAITING);

/**
 * Corpo do `/health` da engine (`status: ok | degraded`) e do coletor (`data.status: ok | degraded | down`).
 * Corpo ilegível não derruba: a resposta 2xx prova que o processo está de pé, mas fica `degraded`.
 */
export function classifyHealthBody(body: unknown): HealthState {
  const status = extractStatus(body);
  if (status === 'ok') return 'ok';
  if (status === 'down') return 'down';
  return 'degraded';
}

function extractStatus(body: unknown): unknown {
  if (typeof body !== 'object' || body === null) return undefined;
  const record = body as Record<string, unknown>;
  if (typeof record.status === 'string') return record.status;
  const data = record.data;
  if (typeof data === 'object' && data !== null && typeof (data as Record<string, unknown>).status === 'string') {
    return (data as Record<string, unknown>).status;
  }
  return undefined;
}

/** Estado final de uma sonda: o pior entre o que o corpo diz e a latência. */
export function combineProbe(bodyState: HealthState, latencyMs: number): HealthState {
  return worstOf([bodyState, classifyLatency(latencyMs)]);
}
