/**
 * Código de inconsistência da regra (day.ts) → valor do CHECK
 * `inconsistencia_tipo` (schema + migration 0009). Um só lugar para a tradução.
 */
import type { InconsistencyCode } from './rules/day';

export const ISSUE_TYPES = [
  'batida_faltando',
  'batidas_impares',
  'interjornada_menor_11h',
  'extra_acima_2h',
  'intervalo_nao_cumprido',
  'marcacao_duplicada',
  'marcacao_fora_de_ordem',
  'marcacao_fora_da_escala',
] as const;
export type IssueType = (typeof ISSUE_TYPES)[number];

const MAP: Readonly<Record<InconsistencyCode, IssueType>> = {
  marcacoes_impares: 'batidas_impares',
  marcacao_ausente: 'batida_faltando',
  marcacao_duplicada: 'marcacao_duplicada',
  marcacao_fora_de_ordem: 'marcacao_fora_de_ordem',
  marcacao_fora_da_escala: 'marcacao_fora_da_escala',
  intervalo_ausente: 'intervalo_nao_cumprido',
  intervalo_insuficiente: 'intervalo_nao_cumprido',
  interjornada_insuficiente: 'interjornada_menor_11h',
  extras_acima_limite: 'extra_acima_2h',
};

/** Sem repetição e em ordem estável. */
export function toIssueTypes(codes: readonly InconsistencyCode[]): IssueType[] {
  return [...new Set(codes.map((c) => MAP[c]))].sort();
}
