/**
 * Trilha de auditoria (RF60, RNF03): `rh.auditorias` só aceita INSERT (trigger
 * trg_auditoria_imutavel). Gravada na MESMA transação da escrita: se a escrita
 * desfaz, a auditoria também.
 *
 * `dados_antes`/`dados_depois` nunca levam CPF, salário, PIN, CID, hash nem
 * segredo (CLAUDE.md, LGPD): esses campos viram só "alterado".
 */
import type { Clock } from '@genus/shared';
import type { Executor } from '../../db/executor';
import { auditLogs } from '../../db/schema';

export type AuditAction =
  | 'criacao'
  | 'alteracao'
  | 'exclusao'
  | 'leitura_sensivel'
  | 'aprovacao'
  | 'recusa'
  | 'fechamento'
  | 'reabertura';

export interface AuditEntry {
  /** null = ação da plataforma (super_admin), fora de qualquer conta. */
  tenantId: number | null;
  /** null = ação do aparelho (totem), sem usuário. */
  userId: number | null;
  entity: string;
  entityId: number;
  action: AuditAction;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  reason?: string | null;
}

const SENSITIVE_KEY = /cpf|salar|pin|cid|hash|senha|password|token|secret|segredo|embedding|dek/i;

/** Copia o objeto trocando o valor de campo sensível por `"[alterado]"`. */
export function redactAudit(data: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!data) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    out[k] = SENSITIVE_KEY.test(k) ? '[alterado]' : v instanceof Date ? v.toISOString() : v;
  }
  return out;
}

export async function recordAudit(ex: Executor, clock: Clock, e: AuditEntry): Promise<void> {
  await ex.insert(auditLogs).values({
    tenantId: e.tenantId,
    userId: e.userId,
    entity: e.entity,
    entityId: e.entityId,
    action: e.action,
    before: redactAudit(e.before),
    after: redactAudit(e.after),
    reason: e.reason ?? null,
    createdAt: clock.now(),
  });
}
