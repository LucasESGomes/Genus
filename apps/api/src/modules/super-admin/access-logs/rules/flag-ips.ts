/**
 * Sinalização de IPs suspeitos de força bruta ou de varredura de contas. Função pura: só SINALIZA,
 * nada é bloqueado (o limite de tentativas é do Better Auth).
 *
 * Os contadores "recentes" chegam prontos do repositório, calculados relativos ao instante da consulta:
 *   - `recentFailures`: falhas nos últimos 15 minutos.
 *   - `recentDistinctAccounts`: e-mails distintos (hash) nos últimos 60 minutos.
 * "10 falhas em qualquer intervalo de 15 minutos" é aproximado por "10 falhas nos últimos 15 minutos":
 * o painel mostra o que está acontecendo agora; um surto antigo continua visível nas contagens da janela.
 */

/** [A CONFIRMAR] limiares de sinalização (valor de negócio, ainda sem aprovação). */
export const FLAG_FAILURES_THRESHOLD = 10;
/** [A CONFIRMAR] */
export const FLAG_FAILURES_WINDOW_MINUTES = 15;
/** [A CONFIRMAR] */
export const FLAG_ACCOUNTS_THRESHOLD = 3;
/** [A CONFIRMAR] */
export const FLAG_ACCOUNTS_WINDOW_MINUTES = 60;
/** Teto da resposta. */
export const FLAGGED_IPS_LIMIT = 200;

export type FlagReason = 'muitas_falhas' | 'muitas_contas';

export interface Thresholds {
  failures: number;
  accounts: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = { failures: FLAG_FAILURES_THRESHOLD, accounts: FLAG_ACCOUNTS_THRESHOLD };

export interface IpAggregate {
  ipAddress: string;
  failures: number;
  successes: number;
  distinctAccounts: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  recentFailures: number;
  recentDistinctAccounts: number;
}

export interface FlaggedIp extends IpAggregate {
  flagged: boolean;
  reasons: FlagReason[];
}

/** IPs com ao menos uma falha; sinalizados primeiro, depois mais falhas, depois o mais recente. */
export function flagIps(rows: readonly IpAggregate[], thresholds: Thresholds = DEFAULT_THRESHOLDS, limit = FLAGGED_IPS_LIMIT): FlaggedIp[] {
  return rows
    .filter((r) => r.failures >= 1)
    .map((r): FlaggedIp => {
      const reasons: FlagReason[] = [];
      if (r.recentFailures >= thresholds.failures) reasons.push('muitas_falhas');
      if (r.recentDistinctAccounts >= thresholds.accounts) reasons.push('muitas_contas');
      return { ...r, flagged: reasons.length > 0, reasons };
    })
    .sort((a, b) => Number(b.flagged) - Number(a.flagged) || b.failures - a.failures || b.lastSeenAt.getTime() - a.lastSeenAt.getTime())
    .slice(0, limit);
}
