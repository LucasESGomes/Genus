/**
 * Saúde da plataforma para o super_admin. Cada dependência é consultada em paralelo, com prazo
 * (`healthTimeoutMs`, padrão 1500 ms), e o resultado fica em cache por 5 s: o painel consulta a cada
 * 15 s de várias abas e não deve martelar o Postgres, o Valkey, a engine e o coletor.
 *
 * Nada que sai daqui carrega URL, credencial ou texto de exceção: o `detail` é uma frase fixa em pt-BR
 * e o log leva só `err.name`.
 */
import type { HEALTH_SERVICES } from '../contract';
import type { SuperAdminDeps } from '../deps';
import {
  classifyHealthBody,
  classifyJobs,
  classifyLatency,
  classifyRepCore,
  combineProbe,
  worstOf,
  type HealthState,
} from './rules/classify-health';

export type HealthService = (typeof HEALTH_SERVICES)[number];

export interface HealthCheck {
  service: HealthService;
  status: HealthState;
  latencyMs: number | null;
  detail: string | null;
  metrics: Record<string, number> | null;
}

export interface SystemHealth {
  status: HealthState;
  checkedAt: string;
  version: string;
  uptimeSeconds: number;
  checks: HealthCheck[];
}

/** Cache: quanto tempo o resultado de uma consulta vale. */
export const HEALTH_CACHE_MS = 5000;
const DEFAULT_TIMEOUT_MS = 1500;

class CheckTimeout extends Error {
  override readonly name = 'CheckTimeout';
}

interface Outcome {
  status: HealthState;
  detail: string | null;
  metrics: Record<string, number> | null;
}

const outcome = (status: HealthState, detail: string | null = null, metrics: Record<string, number> | null = null): Outcome => ({ status, detail, metrics });

export class SystemHealthService {
  private cache: { at: number; checks: HealthCheck[]; checkedAt: string } | null = null;
  private inflight: Promise<{ checks: HealthCheck[]; checkedAt: string }> | null = null;

  constructor(private readonly deps: SuperAdminDeps) {}

  async get(): Promise<SystemHealth> {
    const now = this.deps.clock.now();
    let snapshot: { checks: HealthCheck[]; checkedAt: string };
    if (this.cache && now.getTime() - this.cache.at < HEALTH_CACHE_MS) {
      snapshot = this.cache;
    } else {
      // Várias requisições simultâneas compartilham a mesma rodada de checks.
      this.inflight ??= this.runAll().finally(() => {
        this.inflight = null;
      });
      snapshot = await this.inflight;
    }
    return {
      status: worstOf(snapshot.checks.map((c) => c.status)),
      checkedAt: snapshot.checkedAt,
      version: this.deps.version,
      uptimeSeconds: Math.max(0, Math.floor((now.getTime() - this.deps.startedAt.getTime()) / 1000)),
      checks: snapshot.checks,
    };
  }

  private async runAll(): Promise<{ checks: HealthCheck[]; checkedAt: string }> {
    const startedAt = this.deps.clock.now();
    const checks = await Promise.all([
      this.api(startedAt),
      this.timed('postgres_app', () => this.databaseCheck(() => this.deps.appPool.query('SELECT 1').then(() => undefined))),
      this.timed('postgres_arp', () => this.databaseCheck(() => this.deps.arpOps.ping())),
      this.valkey(),
      this.http('face_engine', this.deps.probes.engineUrl, 'Engine'),
      this.http('collector_api', this.deps.probes.collectorUrl, 'API do coletor'),
      this.repCore(),
      this.jobs(),
    ]);
    const checkedAt = this.deps.clock.now();
    this.cache = { at: checkedAt.getTime(), checks, checkedAt: checkedAt.toISOString() };
    return this.cache;
  }

  // ---------------------------------------------------------------- checks

  private api(now: Date): HealthCheck {
    const uptimeSeconds = Math.max(0, Math.floor((now.getTime() - this.deps.startedAt.getTime()) / 1000));
    return { service: 'api', status: 'ok', latencyMs: 0, detail: null, metrics: { uptimeSeconds } };
  }

  private async databaseCheck(run: () => Promise<void>): Promise<Outcome> {
    await run();
    return outcome('ok');
  }

  private async valkey(): Promise<HealthCheck> {
    const q = this.deps.queues;
    if (!q) return this.unconfigured('valkey', 'VALKEY_URL não configurada');
    return this.timed('valkey', async () => {
      await q.ping();
      return outcome('ok');
    });
  }

  private async http(service: 'face_engine' | 'collector_api', baseUrl: string | null, label: string): Promise<HealthCheck> {
    if (!baseUrl) return this.unconfigured(service, 'não configurado');
    const url = `${baseUrl.replace(/\/+$/, '')}/health`;
    return this.timed(service, async (signal) => {
      const res = await fetch(url, { signal, headers: { accept: 'application/json' } });
      if (!res.ok) return outcome('down', `${label} respondeu com erro.`);
      const body: unknown = await res.json().catch(() => null);
      const state = classifyHealthBody(body);
      return outcome(state, state === 'ok' ? null : `${label} está degradada.`);
    });
  }

  private async repCore(): Promise<HealthCheck> {
    return this.timed('rep_core', async () => {
      const [pending, queue] = await Promise.all([
        this.deps.arpOps.pendingEntries(),
        this.deps.queues ? this.deps.queues.counts('punches').catch((): null => this.noteQueueFailure('punches')) : Promise.resolve(null),
      ]);
      const state = classifyRepCore({ oldestPendingAgeSeconds: pending.oldestAgeSeconds, waiting: queue?.waiting ?? null });
      const metrics: Record<string, number> = { pendingEntries: pending.count };
      if (pending.oldestAgeSeconds !== null) metrics.oldestPendingAgeSeconds = pending.oldestAgeSeconds;
      if (queue) Object.assign(metrics, queueMetrics(queue));
      return this.backlogOutcome(state, metrics, 'Entradas pendentes há muito tempo: o rep-core pode estar parado.', this.deps.queues !== null && queue === null);
    });
  }

  private async jobs(): Promise<HealthCheck> {
    return this.timed('jobs', async () => {
      const [pending, queue] = await Promise.all([
        this.deps.arpOps.pendingOutbox(),
        this.deps.queues ? this.deps.queues.counts('post-punch').catch((): null => this.noteQueueFailure('post-punch')) : Promise.resolve(null),
      ]);
      const state = classifyJobs({ oldestPendingAgeSeconds: pending.oldestAgeSeconds, waiting: queue?.waiting ?? null });
      const metrics: Record<string, number> = { pendingOutbox: pending.count };
      if (pending.oldestAgeSeconds !== null) metrics.oldestPendingAgeSeconds = pending.oldestAgeSeconds;
      if (queue) Object.assign(metrics, queueMetrics(queue));
      return this.backlogOutcome(state, metrics, 'Eventos pós-batida acumulados: os jobs podem estar parados.', this.deps.queues !== null && queue === null);
    });
  }

  private backlogOutcome(state: HealthState, metrics: Record<string, number>, backlogDetail: string, queueFailed: boolean): Outcome {
    // Valkey fora: o arp ainda diz se há atraso, mas ninguém consome sem a fila.
    const status = queueFailed ? worstOf([state, 'degraded']) : state;
    if (state !== 'ok') return outcome(status, backlogDetail, metrics);
    if (queueFailed) return outcome(status, 'Fila indisponível; só o banco foi consultado.', metrics);
    if (this.deps.queues === null) return outcome(status, 'Fila não consultada (Valkey não configurado); só o banco foi consultado.', metrics);
    return outcome(status, null, metrics);
  }

  // ---------------------------------------------------------------- infra

  private noteQueueFailure(queue: string): null {
    this.deps.logger.warn({ queue }, 'saúde: falha ao ler a fila');
    return null;
  }

  private unconfigured(service: HealthService, detail: string): HealthCheck {
    return { service, status: 'degraded', latencyMs: null, detail, metrics: null };
  }

  /** Executa com prazo e mede a latência. A exceção vira `down` com frase fixa; o log leva só `err.name`. */
  private async timed(service: HealthService, run: (signal: AbortSignal) => Promise<Outcome>): Promise<HealthCheck> {
    const timeoutMs = this.deps.healthTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const started = performance.now();
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new CheckTimeout());
        }, timeoutMs);
      });
      const result = await Promise.race([run(controller.signal), timeout]);
      const latencyMs = Math.round(performance.now() - started);
      return { service, status: combineProbe(result.status, latencyMs), latencyMs, detail: result.detail ?? (classifyLatency(latencyMs) === 'ok' ? null : 'Resposta lenta.'), metrics: result.metrics };
    } catch (err) {
      const latencyMs = Math.round(performance.now() - started);
      const name = err instanceof Error ? err.name : 'NonError';
      this.deps.logger.warn({ service, err: { name } }, 'saúde: check falhou');
      return { service, status: 'down', latencyMs, detail: err instanceof CheckTimeout ? 'Sem resposta dentro do prazo.' : 'Não foi possível consultar o serviço.', metrics: null };
    } finally {
      clearTimeout(timer);
    }
  }
}

function queueMetrics(q: { waiting: number; active: number; delayed: number; failed: number; oldestWaitingAgeSeconds: number | null }): Record<string, number> {
  const m: Record<string, number> = { waiting: q.waiting, active: q.active, delayed: q.delayed, failed: q.failed };
  if (q.oldestWaitingAgeSeconds !== null) m.oldestWaitingAgeSeconds = q.oldestWaitingAgeSeconds;
  return m;
}
