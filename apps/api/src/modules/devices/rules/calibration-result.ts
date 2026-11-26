/**
 * Resultado de uma calibração do totem: junta o que a engine devolveu (reconhecimento e vivacidade)
 * no resumo que fica no banco (docs/totem-contrato.md §2). Função pura, testável por tabela.
 * O resultado guarda só números agregados e frases em pt-BR: nunca imagem nem embedding.
 */
import type { EngineLivenessCalibration, EngineRecognitionCalibration } from '../../facial/engine-client';

/** Faixas aceitas pela engine (ThresholdConfig) e pelo CHECK da coluna. */
export const RECOGNITION_RANGE = { min: 0.5, max: 2.0 } as const;
export const LIVENESS_RANGE = { min: 0.5, max: 0.95 } as const;

export interface Thresholds {
  recognitionThreshold: number;
  livenessThreshold: number;
}

export type CalibrationProfileName = NonNullable<EngineRecognitionCalibration['recommended_profile']>;

export interface CalibrationProfile {
  profile: CalibrationProfileName;
  label: string;
  recognitionThreshold: number;
  /** 0 a 1. */
  genuineAcceptRate: number;
  impostorRejectRate: number;
  interpretation: string;
}

export interface CalibrationResult {
  current: Thresholds;
  proposed: Thresholds;
  /** 0 a 100: o quanto as fotos separam bem quem é quem (reconhecimento) e rosto real de tela (vivacidade). */
  qualityScore: number;
  recommendations: string[];
  /** `bucket` = início da faixa de distância (menor = mais parecido). */
  distanceHistogram: { bucket: number; genuine: number; impostor: number }[];
  /** Ausentes em sessões antigas. */
  recommendedProfile?: CalibrationProfileName;
  profiles?: CalibrationProfile[];
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const round = (v: number, digits: number) => Number(v.toFixed(digits));
const recognitionValue = (v: number) => round(clamp(v, RECOGNITION_RANGE.min, RECOGNITION_RANGE.max), 2);

export function buildCalibrationResult(input: {
  current: Thresholds;
  recognition: EngineRecognitionCalibration;
  liveness: EngineLivenessCalibration;
}): CalibrationResult {
  const { recognition, liveness, current } = input;
  const proposed: Thresholds = {
    recognitionThreshold: recognitionValue(recognition.recommended_threshold),
    livenessThreshold: round(clamp(liveness.suggested_thresholds.liveness, LIVENESS_RANGE.min, LIVENESS_RANGE.max), 2),
  };

  // AUC (0,5 = acaso, 1 = perfeito) e Youden (0 a 1) viram uma nota única de 0 a 100.
  const recognitionQuality = clamp((recognition.auc - 0.5) * 2, 0, 1);
  const livenessQuality = clamp(liveness.liveness_analysis.youden_score, 0, 1);
  let qualityScore = Math.round(100 * (0.7 * recognitionQuality + 0.3 * livenessQuality));
  const lowConfidence = recognition.confidence === 'low' || liveness.liveness_analysis.confidence === 'low';
  // com poucas fotos válidas a nota não pode parecer boa
  if (lowConfidence) qualityScore = Math.min(qualityScore, 60);

  const recommendations: string[] = [];
  if (lowConfidence) recommendations.push('Poucas fotos válidas. Refaça a calibração com boa iluminação e o rosto de frente, sem boné nem óculos escuros.');
  if (recognition.eer > 0.1) recommendations.push('As pessoas de dentro e de fora ficaram parecidas para o reconhecimento. Use pessoas diferentes entre si e fotos mais nítidas.');
  if (liveness.liveness_analysis.attack_block_rate < 0.8) recommendations.push('Nem toda foto de rosto na tela foi bloqueada. Use uma tela maior e mais clara na etapa da foto na tela.');
  if (liveness.liveness_analysis.real_pass_rate < 0.8) recommendations.push('Alguns rostos reais foram tomados por foto. Melhore a iluminação do local do totem.');
  for (const w of [recognition.warning, liveness.warning]) {
    if (w && !recommendations.includes(w)) recommendations.push(w);
  }
  if (recommendations.length === 0) recommendations.push('Calibração boa. Aplique os valores propostos.');

  return {
    current,
    proposed,
    qualityScore: clamp(qualityScore, 0, 100),
    recommendations,
    distanceHistogram: recognition.chart_data.histogram.map((b) => ({ bucket: round(b.range_start, 2), genuine: b.genuine_count, impostor: b.impostor_count })),
    ...(recognition.options?.length && recognition.recommended_profile
      ? {
          recommendedProfile: recognition.recommended_profile,
          profiles: recognition.options.map((o) => ({
            profile: o.profile,
            label: o.profile_label,
            recognitionThreshold: recognitionValue(o.threshold),
            genuineAcceptRate: o.genuine_accept_rate,
            impostorRejectRate: o.impostor_reject_rate,
            interpretation: o.interpretation,
          })),
        }
      : {}),
  };
}

/** Pessoa de um arquivo da calibração (`p1_2.jpg` → `p1`): mesmo critério da engine (prefixo antes do último `_`). */
export function personOfCalibrationFile(filename: string): string {
  const stem = filename.replace(/\.[^.]*$/, '');
  const at = stem.lastIndexOf('_');
  return at > 0 ? stem.slice(0, at) : stem;
}
