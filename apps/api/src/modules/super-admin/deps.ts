/**
 * Dependências do painel do super_admin (montadas no container; trocadas nos testes).
 * As interfaces de leitura do arp e do Valkey ficam aqui para os módulos dependerem do contrato,
 * não da implementação (src/arp/recognition-reader.ts, src/arp/ops-reader.ts, system-health/queue-inspector.ts).
 */
import type { Clock, Logger } from '@genus/shared';
import type { Pool } from 'pg';
import type { Database } from '../../db/client';

/** Filtro comum das leituras do arp. `tenantId` null = todas as contas (só o super_admin chega aqui). */
export interface ArpScope {
  tenantId: number | null;
  establishmentId?: number | undefined;
  deviceId?: number | undefined;
  from: Date;
  to: Date;
}

export interface RecognitionAggregateRow {
  punches: number;
  pendente: number;
  processado: number;
  falhou: number;
  divergentClock: number;
  recognitionAvg: number | null;
  recognitionP50: number | null;
  recognitionP05: number | null;
  livenessAvg: number | null;
  livenessP50: number | null;
  livenessP05: number | null;
  /** 10 faixas de 0 a 1. */
  livenessHistogram: number[];
}

export interface RecognitionSeriesRow {
  bucketStart: Date;
  punches: number;
  failed: number;
  avgRecognitionScore: number | null;
  avgLivenessScore: number | null;
}

export interface RecognitionDeviceRow {
  tenantId: number;
  establishmentId: number;
  deviceId: number;
  punches: number;
  failed: number;
  divergentClock: number;
  avgRecognitionScore: number | null;
  avgLivenessScore: number | null;
  lastPunchAt: Date | null;
}

/** Só agregados de `arp.entradas` (04 §1.4: o super_admin não vê batida individual). */
export interface RecognitionStatsReader {
  summary(scope: ArpScope): Promise<RecognitionAggregateRow>;
  series(scope: ArpScope, bucket: 'hour' | 'day'): Promise<RecognitionSeriesRow[]>;
  devices(scope: ArpScope): Promise<RecognitionDeviceRow[]>;
}

/** Leituras operacionais do arp (stats e saúde). */
export interface ArpOpsReader {
  ping(): Promise<void>;
  /** Batidas por dia (UTC) e por conta na janela. */
  punchesPerDay(scope: Pick<ArpScope, 'tenantId' | 'from' | 'to'>): Promise<{ day: string; tenantId: number; punches: number; processed: number }[]>;
  /** `entradas` pendentes: quantas e a idade da mais antiga (idx_entradas_pendentes). */
  pendingEntries(): Promise<{ count: number; oldestAgeSeconds: number | null }>;
  /** `outbox` pendente: quantos e a idade do mais antigo (idx_outbox_pendentes). */
  pendingOutbox(): Promise<{ count: number; oldestAgeSeconds: number | null }>;
}

export interface QueueCounts {
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  oldestWaitingAgeSeconds: number | null;
}

/** Valkey/BullMQ, só leitura (filas `punches` e `post-punch`). */
export interface QueueInspector {
  ping(): Promise<void>;
  counts(queue: 'punches' | 'post-punch'): Promise<QueueCounts>;
}

export interface SuperAdminDeps {
  db: Database;
  /** Pool do banco app (health). */
  appPool: Pick<Pool, 'query'>;
  clock: Clock;
  logger: Logger;
  recognition: RecognitionStatsReader;
  arpOps: ArpOpsReader;
  /** null = VALKEY_URL ausente: Valkey, rep-core e jobs aparecem como `degraded` só pelo arp. */
  queues: QueueInspector | null;
  /** URLs base (sem credencial) dos /health. null = não configurado. */
  probes: { engineUrl: string | null; collectorUrl: string | null };
  /** KEK (64 hex) para gerar a DEK da empresa nova. null = POST /tenants responde 503 MASTER_KEY_AUSENTE. */
  masterKeyHex: string | null;
  /** Chave do HMAC do CPF dos convites; a mesma do portal. */
  inviteCpfHashKey: Buffer;
  /** Versão do pacote e instante de partida (health). */
  version: string;
  startedAt: Date;
  /** Prazo de cada check de saúde. */
  healthTimeoutMs?: number;
}
