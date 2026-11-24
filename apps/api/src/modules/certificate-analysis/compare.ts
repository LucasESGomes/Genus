/**
 * Comparação entre modelos: a mesma entrada em dois ou mais modelos configurados.
 * Mede concordância por campo, divergências e tempo de resposta e, quando há
 * gabarito (atestados sintéticos), o acerto de cada modelo por campo.
 *
 * O relatório não traz texto do atestado nem CID: só situações, recomendações e tempos.
 */
import { FIELD_ITEMS, type FieldItem, type FieldStatusValue, type Recommendation } from './ai/output-schema';
import type { AnalysisOutcome } from './pipeline';
import { ANALYSIS_NOTICE, RULES_VERSION } from './rules/weights';
import { PROMPT_VERSION } from './ai/prompt';

export type FieldVerdicts = Partial<Record<FieldItem, FieldStatusValue>>;

export interface CaseRun {
  caseId: string;
  /** Gabarito por campo; ausente quando a entrada é real (sem gabarito). */
  expected?: { fields: FieldVerdicts; recommendation?: Recommendation; blocksAi?: boolean };
  /** Resultado por modelo (`provedor:modelo`). */
  outcomes: Record<string, AnalysisOutcome>;
}

export interface ModelSummary {
  model: string;
  runs: number;
  failures: number;
  avgMs: number | null;
  maxMs: number | null;
  /** Acerto por campo (0 a 1) contra o gabarito; null sem gabarito. */
  accuracy: Partial<Record<FieldItem, number>> | null;
  overallAccuracy: number | null;
  warnings: string[];
}

export interface Divergence {
  caseId: string;
  field: FieldItem | 'recommendation';
  values: Record<string, string>;
  expected?: string;
}

export interface ComparisonReport {
  generatedAt: string;
  notice: string;
  promptVersion: string;
  rulesVersion: string;
  models: string[];
  cases: number;
  /** Fração dos casos em que TODOS os modelos deram a mesma situação ao campo. */
  agreementByField: Record<FieldItem | 'recommendation', number>;
  summaries: ModelSummary[];
  divergences: Divergence[];
}

const fieldOf = (o: AnalysisOutcome, item: FieldItem): string => {
  if (o.ai.status === 'falhou') return `falha:${o.ai.failure}`;
  if (o.ai.status === 'nao_executada') return 'nao_executada';
  return o.checkedFields.find((f) => f.item === item)?.status ?? 'sem_resposta';
};

export function buildComparison(runs: readonly CaseRun[], generatedAt: Date): ComparisonReport {
  const models = [...new Set(runs.flatMap((r) => Object.keys(r.outcomes)))];
  const keys = [...FIELD_ITEMS, 'recommendation'] as const;
  const agree: Record<string, number> = Object.fromEntries(keys.map((k) => [k, 0]));
  const divergences: Divergence[] = [];

  for (const run of runs) {
    for (const key of keys) {
      const values: Record<string, string> = {};
      for (const m of models) {
        const o = run.outcomes[m];
        if (!o) continue;
        values[m] = key === 'recommendation' ? o.recommendation : fieldOf(o, key);
      }
      const distinct = new Set(Object.values(values));
      if (distinct.size <= 1) agree[key]! += 1;
      else {
        const expected = key === 'recommendation' ? run.expected?.recommendation : run.expected?.fields[key];
        divergences.push({ caseId: run.caseId, field: key, values, ...(expected ? { expected } : {}) });
      }
    }
  }

  const summaries: ModelSummary[] = models.map((model) => {
    const outs = runs.map((r) => ({ r, o: r.outcomes[model] })).filter((x): x is { r: CaseRun; o: AnalysisOutcome } => x.o !== undefined);
    const times = outs.map((x) => x.o.responseMs).filter((t): t is number => t !== null);
    const graded = outs.filter((x) => x.r.expected && x.o.ai.status !== 'nao_executada');
    let accuracy: ModelSummary['accuracy'] = null;
    let overall: number | null = null;
    if (graded.length > 0) {
      accuracy = {};
      let hits = 0;
      let total = 0;
      for (const item of FIELD_ITEMS) {
        const withExpected = graded.filter((x) => x.r.expected!.fields[item] !== undefined);
        if (withExpected.length === 0) continue;
        const ok = withExpected.filter((x) => fieldOf(x.o, item) === x.r.expected!.fields[item]).length;
        accuracy[item] = round(ok / withExpected.length);
        hits += ok;
        total += withExpected.length;
      }
      overall = total > 0 ? round(hits / total) : null;
    }
    return {
      model,
      runs: outs.length,
      failures: outs.filter((x) => x.o.ai.status === 'falhou').length,
      avgMs: times.length ? Math.round(times.reduce((s, t) => s + t, 0) / times.length) : null,
      maxMs: times.length ? Math.max(...times) : null,
      accuracy,
      overallAccuracy: overall,
      warnings: [...new Set(outs.flatMap((x) => x.o.warnings))].sort(),
    };
  });

  return {
    generatedAt: generatedAt.toISOString(),
    notice: ANALYSIS_NOTICE,
    promptVersion: PROMPT_VERSION,
    rulesVersion: RULES_VERSION,
    models,
    cases: runs.length,
    agreementByField: Object.fromEntries(keys.map((k) => [k, runs.length ? round(agree[k]! / runs.length) : 1])) as ComparisonReport['agreementByField'],
    summaries,
    divergences,
  };
}

const round = (n: number) => Math.round(n * 1000) / 1000;
const pct = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${Math.round(n * 100)}%`);

export function renderComparisonMarkdown(r: ComparisonReport): string {
  const lines: string[] = [
    '# Comparativo de modelos: análise de atestados',
    '',
    `Gerado em ${r.generatedAt} · prompt \`${r.promptVersion}\` · regras \`${r.rulesVersion}\` · ${r.cases} atestado(s)`,
    '',
    `> ${r.notice}`,
    '',
    '## Concordância por campo (todos os modelos iguais)',
    '',
    '| Campo | Concordância |',
    '|---|---|',
    ...Object.entries(r.agreementByField).map(([k, v]) => `| ${k} | ${pct(v)} |`),
    '',
    '## Modelos',
    '',
    `| Modelo | Execuções | Falhas | Tempo médio (ms) | Tempo máx. (ms) | Acerto geral | ${FIELD_ITEMS.join(' | ')} | Avisos |`,
    `|---|---|---|---|---|---|${FIELD_ITEMS.map(() => '---').join('|')}|---|`,
    ...r.summaries.map(
      (s) =>
        `| ${s.model} | ${s.runs} | ${s.failures} | ${s.avgMs ?? '—'} | ${s.maxMs ?? '—'} | ${pct(s.overallAccuracy)} | ${FIELD_ITEMS.map((f) => pct(s.accuracy?.[f])).join(' | ')} | ${s.warnings.join(', ') || '—'} |`,
    ),
    '',
    `## Divergências (${r.divergences.length})`,
    '',
  ];
  if (r.divergences.length === 0) lines.push('Nenhuma: todos os modelos concordaram em todos os campos.');
  else {
    lines.push(`| Caso | Campo | ${r.models.join(' | ')} | Gabarito |`, `|---|---|${r.models.map(() => '---').join('|')}|---|`);
    for (const d of r.divergences) lines.push(`| ${d.caseId} | ${d.field} | ${r.models.map((m) => d.values[m] ?? '—').join(' | ')} | ${d.expected ?? '—'} |`);
  }
  lines.push('');
  return lines.join('\n');
}
