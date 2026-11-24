/**
 * Nota de risco (regras) e confiabilidade indicativa (regras + IA), RF67.
 * A confiabilidade tem teto (`RELIABILITY_CAP`): o sistema nunca afirma que o
 * atestado é verdadeiro. Mais alto = menos sinais de problema no texto.
 */
import type { Finding } from './pre-checks';
import {
  FIELD_PENALTIES,
  RELIABILITY_BANDS,
  RELIABILITY_CAP,
  RELIABILITY_CAP_WITHOUT_AI,
  RISK_LEVELS,
  RISK_WEIGHTS,
} from './weights';

export type RiskLevel = 'baixo' | 'medio' | 'alto';
export type ReliabilityBand = 'baixa' | 'media' | 'alta';
export type FieldStatus = keyof typeof FIELD_PENALTIES;

export function riskScore(findings: readonly Finding[]): { score: number; level: RiskLevel } {
  const score = Math.min(100, findings.reduce((s, f) => s + RISK_WEIGHTS[f.code], 0));
  const level: RiskLevel = score >= RISK_LEVELS.alto ? 'alto' : score >= RISK_LEVELS.medio ? 'medio' : 'baixo';
  return { score, level };
}

export interface Reliability {
  score: number;
  band: ReliabilityBand;
  /** Teto aplicado: lembra que a nota nunca chega a 100. */
  cap: number;
}

/**
 * @param fieldStatuses situação dos campos verificados pela IA; null = a IA não rodou ou falhou.
 */
export function reliability(risk: number, fieldStatuses: readonly FieldStatus[] | null): Reliability {
  const cap = fieldStatuses === null ? RELIABILITY_CAP_WITHOUT_AI : RELIABILITY_CAP;
  const penalty = (fieldStatuses ?? []).reduce((s, st) => s + FIELD_PENALTIES[st], 0);
  const score = Math.max(0, Math.min(cap, 100 - risk - penalty));
  const band: ReliabilityBand = score >= RELIABILITY_BANDS.alta ? 'alta' : score >= RELIABILITY_BANDS.media ? 'media' : 'baixa';
  return { score, band, cap };
}
