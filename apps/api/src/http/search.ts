/**
 * Busca por texto das listas (docs/totem-contrato.md §3.3). `q` é dado pessoal (nome): nunca em log.
 * Sem diferenciar maiúsculas nem acento: `unaccent(coluna) ILIKE unaccent(padrão)` (migration 0013).
 * Sem índice: as listas são por estabelecimento e paginadas; se crescer, índice com função imutável.
 */
import { or, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { z } from 'zod';

export const searchText = z.string().trim().min(2).max(100);

/** `%` e `_` (e a própria barra) do texto digitado valem literalmente. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Alguma das colunas contém o texto (sem diferenciar maiúsculas nem acento). */
export function containsAny(columns: readonly AnyColumn[], text: string): SQL {
  const pattern = `%${escapeLike(text)}%`;
  const parts = columns.map((c) => sql`unaccent(${c}) ILIKE unaccent(${pattern})`);
  return (parts.length === 1 ? parts[0] : or(...parts)) as SQL;
}
