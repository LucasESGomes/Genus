/**
 * Pipeline com os 19 atestados sintéticos (test/fixtures/certificates): saída sempre
 * no schema e com aviso, duplicidade barra a IA, CPF e nome não saem, mock
 * determinística, falha da IA tratada e relatório de comparação.
 */
import { describe, expect, it } from 'vitest';
import { FAKE_CPF, FAKE_NAME, SYNTHETIC_CERTIFICATES, type SyntheticCertificate } from '../../../test/fixtures/certificates/synthetic';
import { MockCertificateAiProvider } from './ai/mock-provider';
import type { AiAnalysisInput, CertificateAiProvider } from './ai/provider';
import { buildComparison, renderComparisonMarkdown, type CaseRun } from './compare';
import { runAnalysis, type AnalysisOutcome } from './pipeline';
import { analysisDto } from './schemas';
import { ANALYSIS_NOTICE } from './rules/weights';

class SpyProvider implements CertificateAiProvider {
  readonly provider = 'mock' as const;
  readonly model = 'v1';
  readonly sent: string[] = [];
  private readonly inner = new MockCertificateAiProvider('v1');
  constructor(private readonly reply?: (input: AiAnalysisInput) => unknown) {}
  async analyze(input: AiAnalysisInput) {
    this.sent.push(input.text);
    return this.reply ? this.reply(input) : this.inner.analyze(input);
  }
}

const inputOf = (c: SyntheticCertificate) => ({
  text: c.text,
  person: c.person,
  certificate: { id: 1, ...c.declared },
  others: c.others ?? [],
  deadlineDays: null,
});

/** Mesmo formato da resposta HTTP: prova que a saída cabe no schema público. */
const asDto = (o: AnalysisOutcome) =>
  analysisDto.parse({
    id: 1,
    certificateId: 1,
    provider: o.provider,
    model: o.model,
    promptVersion: o.promptVersion,
    rulesVersion: o.rulesVersion,
    inputHash: o.inputHash,
    analyzedAt: new Date(0).toISOString(),
    responseMs: o.responseMs,
    notice: o.notice,
    warnings: o.warnings,
    recommendation: o.recommendation,
    ai: { status: o.ai.status, failure: o.ai.failure },
    checkedFields: o.checkedFields,
    possibilities: o.possibilities,
    cid: o.cid,
    risk: { ...o.risk, findings: o.findings },
    reliability: o.reliability,
  });

describe('atestados sintéticos', () => {
  it('são de 15 a 20, com ids únicos e gabarito', () => {
    expect(SYNTHETIC_CERTIFICATES.length).toBeGreaterThanOrEqual(15);
    expect(SYNTHETIC_CERTIFICATES.length).toBeLessThanOrEqual(20);
    expect(new Set(SYNTHETIC_CERTIFICATES.map((c) => c.id)).size).toBe(SYNTHETIC_CERTIFICATES.length);
  });

  it.each(SYNTHETIC_CERTIFICATES.map((c) => [c.id, c] as const))('%s: saída no schema, com aviso e teto de confiabilidade', async (_id, c) => {
    const o = await runAnalysis(inputOf(c), { provider: new MockCertificateAiProvider('v1'), warnings: ['IA_SIMULADA'] });
    const dto = asDto(o);
    expect(dto.notice).toBe(ANALYSIS_NOTICE);
    expect(dto.reliability.score).toBeLessThanOrEqual(90);
    expect(dto.recommendation).toBe(c.expected.recommendation);
    if (c.expected.blocksAi) expect(dto.provider).toBe('regras');
    else {
      expect(dto.warnings).toContain('IA_SIMULADA');
      expect(dto.checkedFields).toHaveLength(4);
    }
    if (c.expected.cid) expect(dto.cid!.map((x) => x.code)).toEqual(c.expected.cid);
  });

  it('a mock v1 acerta o gabarito em pelo menos 95% dos campos', async () => {
    let hits = 0;
    let total = 0;
    for (const c of SYNTHETIC_CERTIFICATES) {
      const o = await runAnalysis(inputOf(c), { provider: new MockCertificateAiProvider('v1'), warnings: [] });
      for (const [item, status] of Object.entries(c.expected.fields)) {
        total += 1;
        if (o.checkedFields.find((f) => f.item === item)?.status === status) hits += 1;
      }
    }
    expect(hits / total).toBeGreaterThanOrEqual(0.95);
  });
});

describe('garantias da análise', () => {
  const dup = SYNTHETIC_CERTIFICATES.find((c) => c.id === 's09-duplicado')!;
  const withPersonalData = SYNTHETIC_CERTIFICATES.find((c) => c.id === 's12-cpf-e-nome')!;

  it('duplicidade é barrada pela regra ANTES da IA: o provedor não é chamado', async () => {
    const spy = new SpyProvider();
    const o = await runAnalysis(inputOf(dup), { provider: spy, warnings: ['IA_SIMULADA'] });
    expect(spy.sent).toHaveLength(0);
    expect(o).toMatchObject({ provider: 'regras', model: null, recommendation: 'revisar_manual', ai: { status: 'nao_executada' } });
    expect(o.findings.map((f) => f.code)).toContain('atestado_duplicado');
    expect(o.warnings).toEqual(['IA_NAO_CHAMADA']);
  });

  it('CPF e nome são removidos antes do envio, em todos os sintéticos', async () => {
    const spy = new SpyProvider();
    for (const c of SYNTHETIC_CERTIFICATES) await runAnalysis(inputOf(c), { provider: spy, warnings: [] });
    expect(spy.sent.length).toBe(SYNTHETIC_CERTIFICATES.length - 1);
    const sent = spy.sent.join('\n');
    expect(sent.replace(/\D/g, '')).not.toContain(FAKE_CPF);
    expect(sent).not.toMatch(/529\.982\.247-25/);
    for (const part of FAKE_NAME.split(' ')) expect(sent.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()).not.toContain(part.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase());
    expect(spy.sent.find((t) => t.includes('Paciente:'))).toContain('[NOME] - CPF [CPF]');
    const o = await runAnalysis(inputOf(withPersonalData), { provider: new SpyProvider(), warnings: [] });
    expect(o.removed).toMatchObject({ cpf: 1 });
  });

  it('a IA nunca decide: a saída não tem status de atestado, só recomendação', async () => {
    for (const c of SYNTHETIC_CERTIFICATES) {
      const o = await runAnalysis(inputOf(c), { provider: new MockCertificateAiProvider('v1'), warnings: [] });
      expect(['revisar_manual', 'sem_recomendacao']).toContain(o.recommendation);
      expect(JSON.stringify(o)).not.toMatch(/"status":"(aprovado|recusado)"/);
    }
  });

  it('mesma entrada → mesmo resultado e mesmo hash', async () => {
    const c = SYNTHETIC_CERTIFICATES[0]!;
    const strip = (o: AnalysisOutcome) => ({ ...o, responseMs: null });
    const a = await runAnalysis(inputOf(c), { provider: new MockCertificateAiProvider('v1'), warnings: [] });
    const b = await runAnalysis(inputOf(c), { provider: new MockCertificateAiProvider('v1'), warnings: [] });
    expect(strip(a)).toEqual(strip(b));
    expect(a.inputHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    ['saída fora do schema', () => '{"recommendation":"aprovar"}', 'saida_fora_do_schema'],
    ['provedor responde lixo', () => 'isto não é json', 'saida_fora_do_schema'],
  ])('%s → falha tratada, nada da IA no resultado, revisar_manual', async (_l, reply, failure) => {
    const o = await runAnalysis(inputOf(SYNTHETIC_CERTIFICATES[0]!), { provider: new SpyProvider(reply), warnings: [] });
    expect(o.ai).toMatchObject({ status: 'falhou', failure });
    expect(o.checkedFields).toEqual([]);
    expect(o.recommendation).toBe('revisar_manual');
    expect(o.reliability.cap).toBe(50);
    expect(() => asDto(o)).not.toThrow();
  });

  it('erro inesperado do provedor (não tratado) sobe: não vira falso sucesso', async () => {
    const boom = new SpyProvider(() => {
      throw new TypeError('bug');
    });
    await expect(runAnalysis(inputOf(SYNTHETIC_CERTIFICATES[0]!), { provider: boom, warnings: [] })).rejects.toThrow('bug');
  });
});

describe('comparação entre modelos', () => {
  it('gera relatório com concordância por campo, divergências, tempos e acerto contra o gabarito', async () => {
    const runs: CaseRun[] = [];
    for (const c of SYNTHETIC_CERTIFICATES) {
      const outcomes: Record<string, AnalysisOutcome> = {};
      for (const m of ['v1', 'estrito'] as const) {
        outcomes[`mock:${m}`] = await runAnalysis(inputOf(c), { provider: new MockCertificateAiProvider(m), warnings: ['IA_SIMULADA'] });
      }
      runs.push({ caseId: c.id, expected: c.expected, outcomes });
    }
    const report = buildComparison(runs, new Date('2026-11-24T12:00:00Z'));
    expect(report.models).toEqual(['mock:v1', 'mock:estrito']);
    expect(report.cases).toBe(SYNTHETIC_CERTIFICATES.length);
    expect(report.notice).toBe(ANALYSIS_NOTICE);
    expect(report.divergences).toContainEqual(
      expect.objectContaining({ caseId: 's19-crm-sem-uf', field: 'profissional', expected: 'incoerente', values: { 'mock:v1': 'ok', 'mock:estrito': 'incoerente' } }),
    );
    expect(report.agreementByField.profissional).toBeLessThan(1);
    expect(report.agreementByField.data_atestado).toBe(1);
    const [v1, strict] = report.summaries;
    expect(v1!.overallAccuracy!).toBeLessThan(strict!.overallAccuracy!);
    expect(strict!.overallAccuracy).toBe(1);
    expect(v1!.avgMs).not.toBeNull();

    const md = renderComparisonMarkdown(report);
    expect(md).toContain('# Comparativo de modelos');
    expect(md).toContain('s19-crm-sem-uf');
    // O relatório não leva texto do atestado nem CID.
    expect(md).not.toMatch(/Helena|J11\.1|52998224725/);
  });
});
