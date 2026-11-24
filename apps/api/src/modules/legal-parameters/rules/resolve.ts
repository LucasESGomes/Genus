/**
 * Parâmetro legal vigente numa data (RF10, RN06, RNF06).
 *
 * Espelha `rh.parametros_legais`: chave, valor JSONB e vigência `[vigencia_inicio,
 * vigencia_fim]` (fim NULL = em aberto, inclusivo). `empresa_id` NULL é o padrão
 * legal; uma linha da empresa (acordo, convenção) tem precedência sobre o padrão
 * [A CONFIRMAR]. Nenhum valor legal fica no código: as regras pedem tudo aqui.
 */
import { isWithin, timeOfDayMinutes, type CivilDate } from '../../rules-common/rules/civil-time';
import { RhDomainError } from '../../rules-common/rules/errors';

export interface LegalParameterRow {
  id: string;
  companyId: string | null;
  key: string;
  value: unknown;
  legalBasis: string | null;
  validFrom: CivilDate;
  validTo: CivilDate | null;
}

export interface ResolveOptions {
  /** Empresa do colaborador. Sem ela, só o padrão legal (empresa NULL) vale. */
  companyId?: string | null;
}

/**
 * Devolve a única linha vigente para `key` em `date`. Falha com
 * `PARAMETRO_AUSENTE` se não houver nenhuma e `PARAMETRO_AMBIGUO` se houver
 * mais de uma no mesmo nível (empresa ou padrão).
 */
export function resolveParameter(
  rows: readonly LegalParameterRow[],
  key: string,
  date: CivilDate,
  options: ResolveOptions = {},
): LegalParameterRow {
  const valid = rows.filter((r) => r.key === key && isWithin(date, r.validFrom, r.validTo));
  const companyId = options.companyId ?? null;
  const own = companyId === null ? [] : valid.filter((r) => r.companyId === companyId);
  const level = own.length > 0 ? own : valid.filter((r) => r.companyId === null);

  if (level.length === 0) {
    throw new RhDomainError('PARAMETRO_AUSENTE', `Nenhum parâmetro "${key}" vigente em ${date}`, { key, date });
  }
  if (level.length > 1) {
    throw new RhDomainError(
      'PARAMETRO_AMBIGUO',
      `Mais de um parâmetro "${key}" vigente em ${date}`,
      { key, date, count: level.length },
    );
  }
  return level[0] as LegalParameterRow;
}

function wrongType(row: LegalParameterRow, expected: string): never {
  throw new RhDomainError('PARAMETRO_INVALIDO', `Parâmetro "${row.key}" deveria ser ${expected}`, {
    key: row.key,
    id: row.id,
  });
}

/**
 * Leitor de parâmetros fixado numa data e numa empresa. Guarda as linhas
 * usadas para o cálculo registrar a versão (`apuracoes_dia.parametro_versao`, RNF06).
 */
export class ParameterReader {
  private readonly used = new Map<string, LegalParameterRow>();

  constructor(
    private readonly rows: readonly LegalParameterRow[],
    readonly date: CivilDate,
    private readonly options: ResolveOptions = {},
  ) {}

  row(key: string): LegalParameterRow {
    const row = resolveParameter(this.rows, key, this.date, this.options);
    this.used.set(key, row);
    return row;
  }

  /** Inteiro (minutos, dias, meses, segundos). Nada de float. */
  int(key: string): number {
    const row = this.row(key);
    if (typeof row.value !== 'number' || !Number.isSafeInteger(row.value)) wrongType(row, 'inteiro');
    return row.value;
  }

  bool(key: string): boolean {
    const row = this.row(key);
    if (typeof row.value !== 'boolean') wrongType(row, 'booleano');
    return row.value;
  }

  /** Hora do dia `HH:mm`, devolvida em minutos desde 00:00. */
  timeOfDay(key: string): number {
    const row = this.row(key);
    if (typeof row.value !== 'string') wrongType(row, 'hora HH:mm');
    return timeOfDayMinutes(row.value);
  }

  json<T>(key: string, guard: (value: unknown) => value is T, expected: string): T {
    const row = this.row(key);
    if (!guard(row.value)) wrongType(row, expected);
    return row.value;
  }

  /** `chave@id` das linhas usadas, em ordem de chave: entra em `parametro_versao`. */
  version(): string {
    return [...this.used.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, row]) => `${key}@${row.id}`)
      .join(';');
  }
}
