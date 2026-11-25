/**
 * Período de consulta do painel do super_admin: intervalo [from, to), no máximo 90 dias
 * (docs/prompts/super-admin-contrato.md). Sem `from` nem `to`, não há filtro de tempo.
 * Só `to`: `from` = `to` - 90 dias. Só `from`: `to` = agora (e o intervalo ainda tem de caber em 90 dias).
 */
import { HttpError } from '../../plugins/error-handler';

export const MAX_PERIOD_DAYS = 90;
const DAY_MS = 86_400_000;

export interface Period {
  from?: Date;
  to?: Date;
}

export function resolvePeriod(now: Date, from?: string, to?: string): Period {
  if (from === undefined && to === undefined) return {};
  const end = to === undefined ? now : new Date(to);
  const start = from === undefined ? new Date(end.getTime() - MAX_PERIOD_DAYS * DAY_MS) : new Date(from);
  if (end.getTime() <= start.getTime()) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'O fim do período deve ser depois do início');
  }
  if (end.getTime() - start.getTime() > MAX_PERIOD_DAYS * DAY_MS) {
    throw new HttpError(400, 'VALIDATION_ERROR', `O período pode ter no máximo ${MAX_PERIOD_DAYS} dias`);
  }
  return { from: start, to: end };
}
