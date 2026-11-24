/**
 * Pipeline da análise de UM atestado com UM modelo, sem banco (o service grava;
 * o comando de comparação e os testes usam direto):
 *
 *   1. anonimiza (CPF e nome saem) e confere que nada sobrou;
 *   2. regras determinísticas; duplicidade barra a IA;
 *   3. chama o provedor e valida a resposta contra o schema (fora dele = falha tratada);
 *   4. junta CID das regras e da IA, calcula risco e confiabilidade indicativa;
 *   5. recomenda `revisar_manual` ou `sem_recomendacao`. Nunca decide o atestado.
 */
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { interpretCid, normalizeCid, extractCidCandidates, type CidCandidate } from './rules/cid';
import { runPreChecks, type CertificateFacts, type Finding, type OtherCertificate } from './rules/pre-checks';
import { containsPersonalData, redactPersonalData } from './rules/redact';
import { reliability, riskScore, type Reliability, type RiskLevel } from './rules/reliability';
import { extractTextFacts } from './rules/text-facts';
import { ANALYSIS_NOTICE, RULES_VERSION } from './rules/weights';
import { keepLiteralEvidence, parseAiOutput, type AiOutput, type Recommendation } from './ai/output-schema';
import { PROMPT_VERSION } from './ai/prompt';
import { AiProviderError, type AiFailure, type CertificateAiProvider, type ProviderId } from './ai/provider';

export interface AnalysisInput {
  /** Texto extraído do atestado (ainda com dados pessoais; sai daqui anonimizado). */
  text: string;
  person: { cpf: string; name: string };
  certificate: CertificateFacts;
  others: readonly OtherCertificate[];
  deadlineDays: number | null;
}

export type AiStatus = 'concluida' | 'nao_executada' | 'falhou';

export interface AnalysisOutcome {
  provider: ProviderId | 'regras';
  model: string | null;
  promptVersion: string;
  rulesVersion: string;
  /** SHA-256 (hex) do texto anonimizado + versão do prompt. */
  inputHash: string;
  /** Texto que foi (ou seria) enviado ao provedor. Dado de saúde: só cifrado no banco. */
  redactedText: string;
  removed: { cpf: number; name: number };
  findings: Finding[];
  skippedChecks: string[];
  risk: { score: number; level: RiskLevel };
  ai: { status: AiStatus; failure: AiFailure | null; discardedEvidence: number };
  checkedFields: AiOutput['checkedFields'];
  /** Possibilidades da IA para campos ambíguos, sem as de CID (essas vão em `cid`). */
  possibilities: AiOutput['possibilities'];
  cid: CidCandidate[];
  recommendation: Recommendation;
  reliability: Reliability;
  warnings: string[];
  notice: string;
  responseMs: number | null;
}

export function inputHash(redactedText: string, promptVersion = PROMPT_VERSION): string {
  return createHash('sha256').update(`${promptVersion}\n${redactedText}`, 'utf8').digest('hex');
}

function mergeCid(rules: CidCandidate[], ai: AiOutput | null): CidCandidate[] {
  const byCode = new Map(rules.map((c) => [c.code, c]));
  const fromAi: { code: string; confidence: number }[] = [
    ...(ai?.cidCodes ?? []),
    ...(ai?.possibilities.filter((p) => /cid/i.test(p.field)).flatMap((p) => p.hypotheses.map((h) => ({ code: h.value, confidence: h.confidence }))) ?? []),
  ];
  for (const c of fromAi) {
    const code = normalizeCid(c.code);
    if (!code) continue;
    const prev = byCode.get(code);
    if (prev) {
      // Regra e IA concordam: fica a leitura da regra, com a maior confiança.
      byCode.set(code, { ...prev, confidence: Math.max(prev.confidence, c.confidence) });
    } else {
      byCode.set(code, { ...interpretCid(code), confidence: c.confidence, source: 'ia' });
    }
  }
  return [...byCode.values()].sort((a, b) => b.confidence - a.confidence || a.code.localeCompare(b.code)).slice(0, 5);
}

export async function runAnalysis(
  input: AnalysisInput,
  run: { provider: CertificateAiProvider; warnings: string[] },
): Promise<AnalysisOutcome> {
  const red = redactPersonalData(input.text, input.person);
  const facts = extractTextFacts(red.text);
  const pre = runPreChecks({
    certificate: input.certificate,
    others: input.others,
    text: facts,
    deadlineDays: input.deadlineDays,
    removedPersonalData: red.removed.cpf + red.removed.name,
  });
  const risk = riskScore(pre.findings);
  const hash = inputHash(red.text);
  // Barrada pelas regras: a IA não roda, então o aviso de mock não se aplica.
  const warnings = pre.blocksAi ? ['IA_NAO_CHAMADA'] : [...run.warnings];

  let aiStatus: AiStatus = 'nao_executada';
  let failure: AiFailure | null = null;
  let output: AiOutput | null = null;
  let discarded = 0;
  let responseMs: number | null = null;

  if (!pre.blocksAi) {
    const started = performance.now();
    try {
      // Última barreira: se algo do CPF ou do nome sobrou, não envia.
      if (containsPersonalData(red.text, input.person)) {
        throw new AiProviderError('dados_pessoais_no_envio', 'O texto ainda tem dado pessoal do colaborador; envio cancelado');
      }
      const raw = await run.provider.analyze({ text: red.text, promptVersion: PROMPT_VERSION });
      const kept = keepLiteralEvidence(parseAiOutput(raw), red.text);
      output = kept.output;
      discarded = kept.discarded;
      aiStatus = 'concluida';
    } catch (err) {
      if (!(err instanceof AiProviderError)) throw err;
      aiStatus = 'falhou';
      failure = err.code;
    } finally {
      responseMs = Math.round(performance.now() - started);
    }
  }

  const cid = mergeCid(extractCidCandidates(red.text), output);
  const statuses = output ? output.checkedFields.map((f) => f.status) : null;
  const rel = reliability(risk.score, statuses);
  const serious = pre.findings.some((f) => f.severity !== 'baixa');
  const recommendation: Recommendation =
    aiStatus !== 'concluida' ||
    serious ||
    output!.recommendation === 'revisar_manual' ||
    output!.checkedFields.some((f) => f.status !== 'ok') ||
    rel.band !== 'alta'
      ? 'revisar_manual'
      : 'sem_recomendacao';

  if (discarded > 0) warnings.push('EVIDENCIA_DESCARTADA');
  return {
    provider: pre.blocksAi ? 'regras' : run.provider.provider,
    model: pre.blocksAi ? null : run.provider.model,
    promptVersion: PROMPT_VERSION,
    rulesVersion: RULES_VERSION,
    inputHash: hash,
    redactedText: red.text,
    removed: red.removed,
    findings: pre.findings,
    skippedChecks: pre.skipped,
    risk,
    ai: { status: aiStatus, failure, discardedEvidence: discarded },
    checkedFields: output?.checkedFields ?? [],
    possibilities: output?.possibilities.filter((p) => !/cid/i.test(p.field)) ?? [],
    cid,
    recommendation,
    reliability: rel,
    warnings,
    notice: ANALYSIS_NOTICE,
    responseMs,
  };
}
