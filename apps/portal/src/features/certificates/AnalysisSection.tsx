'use client';
import { CheckCircle, Info, SpinnerGap, WarningCircle } from '@phosphor-icons/react';
import type { UseQueryResult } from '@tanstack/react-query';
import { useState } from 'react';
import { RiskBar } from '@/components/domain';
import { Button } from '@/components/ui/Button';
import { TextArea, TextInput } from '@/components/ui/Fields';
import { notify } from '@/components/ui/notify';
import { QueryView } from '@/components/ui/QueryView';
import { Skeleton } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { CidValue } from '@/components/ui/SensitiveValue';
import {
  ANALYSIS_PROVIDERS, MAX_TEXT_CHARS,
  type AnalysisComparison, type CertificateAnalysis, type EntityId, type Role,
} from '@/lib/api/contracts';
import type { ApiError } from '@/lib/api/errors';
import { useMocks } from '@/lib/api/mocks/runtime';
import { formatInstant } from '@/lib/format';
import {
  AI_FAILURE, ANALYSIS_PROVIDER, CID_SOURCE, CID_STATUS, FIELD_ITEM, FIELD_STATUS, FINDING_SEVERITY, RECOMMENDATION, RELIABILITY_BAND,
  type LabelTone,
} from '@/lib/labels';
import { useApiMutation, useInvalidate } from '@/lib/query/hooks';
import { COPY, MAX_MODELS, MIN_TEXT, WARNING_TEXT } from './copy';

const FINDING_BOX: Record<LabelTone, string> = {
  danger: 'border-danger-line bg-danger-bg',
  warn: 'border-line bg-warn-bg',
  good: 'border-line bg-surface',
  info: 'border-line bg-surface',
  neutral: 'border-line bg-surface',
};

/** Valida a lista `provedor:modelo` digitada. `regras` não é provedor de IA; `mock` só com mocks ligados. */
export function parseModels(raw: string, allowMock: boolean): { models: string[]; error: string | null } {
  const models = raw.split(',').map((m) => m.trim()).filter(Boolean);
  if (models.length > MAX_MODELS) return { models, error: `Informe no máximo ${MAX_MODELS} modelos.` };
  if (new Set(models).size !== models.length) return { models, error: 'Não repita o mesmo modelo.' };
  const providers = ANALYSIS_PROVIDERS.filter((p) => p !== 'regras' && (allowMock || p !== 'mock'));
  for (const m of models) {
    const i = m.indexOf(':');
    const provider = i < 0 ? '' : m.slice(0, i);
    if (i < 0 || i === m.length - 1 || !(providers as readonly string[]).includes(provider)) {
      return { models, error: `Use o formato provedor:modelo. Provedores aceitos: ${providers.join(', ')}.` };
    }
  }
  return { models, error: null };
}

const fieldKeyLabel = (key: string) => (key in FIELD_ITEM ? FIELD_ITEM[key as keyof typeof FIELD_ITEM].label : key.replace(/_/g, ' '));

function AnalysisView({ analysis, role }: { analysis: CertificateAnalysis; role: Role }) {
  const { risk, reliability, ai } = analysis;
  const failed = ai.status === 'falhou';
  // IA falhou: só a parte das regras (CID da IA e hipóteses ficam de fora).
  const cids = (analysis.cid ?? []).filter((c) => !failed || c.source === 'regra');
  const provider = ANALYSIS_PROVIDER[analysis.provider].label + (analysis.model ? ` · ${analysis.model}` : '');
  return (
    <article className="flex flex-col gap-3 rounded-md border border-line p-4" aria-label={`Análise ${provider}`}>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <span className="font-semibold text-ink">{provider}</span>
        <span className="tabular-nums">{formatInstant(analysis.analyzedAt)}</span>
        {ai.status === 'concluida' && <StatusBadge tone="good" label="IA concluída" />}
        {ai.status === 'nao_executada' && <StatusBadge tone="neutral" label="Só regras (IA não executada)" />}
        {failed && <StatusBadge tone="danger" label={`IA falhou${ai.failure ? `: ${AI_FAILURE[ai.failure].label}` : ''}`} />}
      </div>
      {failed && <p role="status" className="m-0 text-sm text-danger">{COPY.aiFailed}</p>}

      <div className="flex flex-col gap-1.5">
        <RiskBar level={risk.level} score={risk.score} />
        <span className="text-xs text-muted">
          Confiabilidade da leitura: {RELIABILITY_BAND[reliability.band].label} ({reliability.score}/100) ·
          Recomendação: {RECOMMENDATION[analysis.recommendation].label}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <h4 className="m-0 text-sm font-bold">Campos conferidos</h4>
        <ul className="m-0 flex list-none flex-col overflow-hidden rounded-md border border-line p-0">
          {analysis.checkedFields.map((f) => {
            const ok = f.status === 'ok';
            return (
              <li key={f.item} className="grid grid-cols-[130px_minmax(0,1fr)_auto] items-start gap-3 border-b border-line px-3 py-2 last:border-b-0 text-sm">
                <span className="text-xs font-medium text-muted">{FIELD_ITEM[f.item].label}</span>
                <span className="min-w-0 break-words">{f.evidence ?? '—'}</span>
                <span className={`inline-flex items-center gap-1 text-xs font-semibold ${ok ? 'text-good' : 'text-warn'}`}>
                  {ok ? <CheckCircle size={14} weight="fill" aria-hidden /> : <WarningCircle size={14} weight="fill" aria-hidden />}
                  {FIELD_STATUS[f.status].label}
                </span>
              </li>
            );
          })}
          {cids.length > 0 && cids.map((c) => (
            <li key={c.code} className="grid grid-cols-[130px_minmax(0,1fr)_auto] items-start gap-3 border-b border-line bg-surface px-3 py-2 text-sm last:border-b-0">
              <span className="text-xs font-medium text-muted">CID</span>
              <span className="min-w-0 break-words">
                <span className="font-semibold tabular-nums"><CidValue role={role} value={c.code} /></span>
                {c.chapterTitle && <span className="text-muted"> · {c.chapterTitle}</span>}
              </span>
              <span className="text-xs text-muted">{CID_STATUS[c.status].label} · {CID_SOURCE[c.source].label}</span>
            </li>
          ))}
        </ul>
      </div>

      {risk.findings.length > 0 && (
        <div className="flex flex-col gap-2">
          <h4 className="m-0 text-sm font-bold">Alertas de consistência</h4>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {risk.findings.map((f) => {
              const sev = FINDING_SEVERITY[f.severity];
              return (
                <li key={f.code} className={`flex flex-wrap items-start gap-2 rounded-md border px-3 py-2 text-sm ${FINDING_BOX[sev.tone]}`}>
                  <StatusBadge tone={sev.tone} label={`Severidade ${sev.label.toLowerCase()}`} />
                  <span className="min-w-0 flex-1 break-words">{f.message}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {analysis.warnings.length > 0 && (
        <ul className="m-0 list-none p-0 text-xs text-muted">
          {analysis.warnings.map((w) => <li key={w}>{WARNING_TEXT[w] ?? `Aviso da análise: ${w}`}</li>)}
        </ul>
      )}

      {/* Sempre exibido: a análise é indicativa e não comprova autenticidade. */}
      <p className="m-0 flex items-start gap-2 rounded-md bg-tint px-3 py-2 text-xs text-ink-2">
        <Info size={16} aria-hidden className="mt-px shrink-0" />
        <span>{analysis.notice}</span>
      </p>
    </article>
  );
}

function ComparisonView({ comparison }: { comparison: AnalysisComparison }) {
  return (
    <section aria-label="Comparação entre modelos" className="flex flex-col gap-2 rounded-md border border-line p-4">
      <h4 className="m-0 text-sm font-bold">Comparação entre modelos</h4>
      <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-sm">
        {Object.entries(comparison.agreementByField).map(([k, v]) => (
          <li key={k}>{fieldKeyLabel(k)}: <span className="font-semibold tabular-nums">{Math.round(v * 100)}% de concordância</span></li>
        ))}
      </ul>
      {comparison.divergences.length > 0 && (
        <ul className="m-0 list-none p-0 text-sm">
          {comparison.divergences.map((d) => (
            <li key={d.field}>
              Divergência em {fieldKeyLabel(d.field)}: {Object.entries(d.values).map(([m, val]) => `${m} → ${val}`).join('; ')}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Análise indicativa (só rh). O texto colado fica no estado desta seção (memória): quem monta a tela usa
 * `key={certificateId}` e desmonta ao fechar o painel, então o texto some nos dois casos. Nunca vai a storage.
 */
export function AnalysisSection({ certificateId, role, pending, query }: {
  certificateId: EntityId;
  role: Role;
  /** Atestado ainda pendente (decidido não aceita nova análise: 409). */
  pending: boolean;
  query: UseQueryResult<CertificateAnalysis[], ApiError>;
}) {
  const [text, setText] = useState('');
  const [modelsRaw, setModelsRaw] = useState('');
  const [lastRun, setLastRun] = useState<{ analyses: CertificateAnalysis[]; comparison: AnalysisComparison | null } | null>(null);
  const invalidate = useInvalidate();
  const mocks = useMocks();

  const analyze = useApiMutation(
    (api, body: { text: string; models?: string[] }) => api.certificates.analyze(certificateId, body),
    {
      invalidates: ['analyses'],
      onSuccess: (r) => {
        setLastRun({ analyses: r.analyses, comparison: r.comparison });
        setText('');
      },
      onError: (e) => {
        notify.error(e);
        if (e.status === 409) void invalidate('certificates', 'analyses');
      },
    },
  );

  const trimmed = text.trim();
  const parsed = parseModels(modelsRaw, mocks);
  const textOk = trimmed.length >= MIN_TEXT && text.length <= MAX_TEXT_CHARS;
  const canSubmit = textOk && parsed.error === null && !analyze.isPending;

  const submit = () => {
    if (!canSubmit) return;
    analyze.mutate({ text: trimmed, ...(parsed.models.length > 0 ? { models: parsed.models } : {}) });
  };

  return (
    <section aria-label={COPY.analysisTitle} className="flex flex-col gap-3">
      <h3 className="m-0 text-sm font-bold">{COPY.analysisTitle}</h3>
      <p className="m-0 text-xs text-muted text-pretty">{COPY.analysisHint}</p>

      <QueryView
        query={query}
        what="as análises"
        loading={<div aria-busy="true" aria-label="Carregando análises" className="flex flex-col gap-2"><Skeleton className="h-4 w-1/2" /><Skeleton className="h-24 w-full" /></div>}
      >
        {(list) => {
          const shown = lastRun ? lastRun.analyses : list.slice(0, 1);
          return (
            <>
              {shown.length === 0 && !analyze.isPending && <p className="m-0 text-sm text-muted">Nenhuma análise feita para este atestado.</p>}
              {shown.map((a) => <AnalysisView key={a.id} analysis={a} role={role} />)}
              {lastRun?.comparison && <ComparisonView comparison={lastRun.comparison} />}
            </>
          );
        }}
      </QueryView>

      {analyze.isPending && (
        <div role="status" className="flex flex-col gap-2 rounded-md border border-line bg-surface p-4">
          <span className="flex items-center gap-2 font-semibold"><SpinnerGap size={18} className="animate-spin" aria-hidden />{COPY.reading}</span>
          <span className="text-xs text-muted">{COPY.readingHint}</span>
          <Skeleton className="h-3 w-4/5" />
          <Skeleton className="h-3 w-3/5" />
        </div>
      )}

      {pending && (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => { e.preventDefault(); submit(); }}
        >
          <TextArea
            label={COPY.textLabel}
            rows={5}
            value={text}
            maxLength={MAX_TEXT_CHARS}
            disabled={analyze.isPending}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setText(e.target.value)}
            hint={`${COPY.textHint} ${text.length.toLocaleString('pt-BR')} de ${MAX_TEXT_CHARS.toLocaleString('pt-BR')} caracteres (mínimo ${MIN_TEXT}).`}
          />
          <TextInput
            label={COPY.modelsLabel}
            value={modelsRaw}
            disabled={analyze.isPending}
            autoComplete="off"
            onChange={(e) => setModelsRaw(e.target.value)}
            hint={`Formato provedor:modelo, separados por vírgula (até ${MAX_MODELS}). Dois ou mais geram comparação.`}
            {...(parsed.error ? { error: parsed.error } : {})}
          />
          <div className="flex justify-end">
            <Button variant="secondary" type="submit" disabled={!canSubmit} loading={analyze.isPending}>{COPY.analyze}</Button>
          </div>
        </form>
      )}
    </section>
  );
}
