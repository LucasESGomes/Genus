/**
 * Provedor simulado, determinístico e sem rede. É o padrão sem chave ou sem
 * decisão de provedor (a resposta da análise avisa `IA_SIMULADA`) e a base dos
 * testes. Mesma entrada → mesma saída, byte a byte.
 *
 * Dois modelos, para a comparação ter o que comparar:
 *   - `v1`: regras do `text-facts`;
 *   - `estrito`: igual, mas exige UF no CRM e marca ilegível com qualquer marca de leitura ruim.
 */
import { diffDays } from '../../rules-common/rules/civil-time';
import { extractCidCandidates } from '../rules/cid';
import { extractTextFacts, type TextFacts } from '../rules/text-facts';
import type { AiOutput, FieldItem, FieldStatusValue } from './output-schema';
import type { AiAnalysisInput, CertificateAiProvider } from './provider';

export const MOCK_MODELS = ['v1', 'estrito'] as const;
export type MockModel = (typeof MOCK_MODELS)[number];

interface Verdict {
  status: FieldStatusValue;
  evidence: string | null;
}

function dateField(f: TextFacts): Verdict {
  if (f.illegibleNear.date && !f.issueDate) return { status: 'ilegivel', evidence: null };
  if (!f.issueDate) return f.ambiguousDates.length > 0 ? { status: 'ilegivel', evidence: f.ambiguousDates[0]!.raw } : { status: 'ausente', evidence: null };
  // Emitido depois do fim do afastamento: o texto se contradiz. Intervalo invertido é erro do período, não da data.
  const end = f.range && f.range.end >= f.range.start ? f.range.end : null;
  if (end && f.issueDate.date > end) return { status: 'incoerente', evidence: f.issueDate.raw };
  return { status: 'ok', evidence: f.issueDate.raw };
}

function periodField(f: TextFacts): Verdict {
  if (f.range && f.range.end < f.range.start) return { status: 'incoerente', evidence: f.range.raw };
  if (f.days) {
    if (f.days.value === 0) return { status: 'incoerente', evidence: f.days.raw };
    if (f.days.words !== null && f.days.words !== f.days.value) return { status: 'incoerente', evidence: f.days.raw };
    if (f.range) {
      const span = diffDays(f.range.start, f.range.end) + 1;
      if (span !== f.days.value) return { status: 'incoerente', evidence: f.range.raw };
    }
    return { status: 'ok', evidence: f.days.raw };
  }
  if (f.range) return { status: 'ok', evidence: f.range.raw };
  if (f.hours) return { status: 'ok', evidence: f.hours.raw };
  return f.illegibleNear.period ? { status: 'ilegivel', evidence: null } : { status: 'ausente', evidence: null };
}

function professionalField(f: TextFacts, model: MockModel): Verdict {
  if (!f.doctor && !f.crm) return f.illegibleNear.doctor ? { status: 'ilegivel', evidence: null } : { status: 'ausente', evidence: null };
  if (!f.crm) return f.illegibleNear.doctor ? { status: 'ilegivel', evidence: f.doctor!.raw } : { status: 'ausente', evidence: f.doctor!.raw };
  const numberOk = /^\d{3,8}$/.test(f.crm.number);
  if (!numberOk) return { status: f.illegibleNear.doctor ? 'ilegivel' : 'incoerente', evidence: f.crm.raw };
  if (model === 'estrito' && f.crm.uf === null) return { status: 'incoerente', evidence: f.crm.raw };
  if (!f.doctor) return { status: model === 'estrito' ? 'ausente' : 'ok', evidence: f.crm.raw };
  return { status: 'ok', evidence: f.crm.raw };
}

function legibilityField(f: TextFacts, text: string, model: MockModel): Verdict {
  const letters = (text.match(/\p{L}/gu) ?? []).length;
  const threshold = model === 'estrito' ? 1 : 3;
  if (f.illegibleMarks >= threshold || letters < 40) return { status: 'ilegivel', evidence: null };
  return { status: 'ok', evidence: null };
}

export function mockAnalysis(text: string, model: MockModel): AiOutput {
  const f = extractTextFacts(text);
  const verdicts: Record<FieldItem, Verdict> = {
    data_atestado: dateField(f),
    periodo_afastamento: periodField(f),
    profissional: professionalField(f, model),
    legibilidade: legibilityField(f, text, model),
  };

  const possibilities: AiOutput['possibilities'] = [];
  for (const amb of f.ambiguousDates.slice(0, 3)) {
    const n = amb.readings.length;
    possibilities.push({
      field: 'data_atestado',
      hypotheses: amb.readings.map((value, i) => ({ value, confidence: n === 1 ? 0.6 : i === 0 ? 0.6 : 0.3 })),
    });
  }
  if (f.days && f.days.words !== null && f.days.words !== f.days.value) {
    possibilities.push({
      field: 'periodo_afastamento',
      hypotheses: [
        { value: `${f.days.value} dias`, confidence: 0.5 },
        { value: `${f.days.words} dias`, confidence: 0.5 },
      ],
    });
  }
  const cids = extractCidCandidates(text);
  const ambiguousCid = cids.filter((c) => c.confidence < 0.9);
  if (ambiguousCid.length > 1) {
    possibilities.push({ field: 'cid', hypotheses: ambiguousCid.slice(0, 5).map((c) => ({ value: c.code, confidence: c.confidence })) });
  }

  const checkedFields = (Object.keys(verdicts) as FieldItem[]).map((item) => ({ item, ...verdicts[item] }));
  const allOk = checkedFields.every((c) => c.status === 'ok');
  return {
    checkedFields,
    possibilities: possibilities.slice(0, 10),
    cidCodes: cids.slice(0, 5).map((c) => ({ code: c.code, confidence: c.confidence })),
    recommendation: allOk && possibilities.length === 0 ? 'sem_recomendacao' : 'revisar_manual',
  };
}

export class MockCertificateAiProvider implements CertificateAiProvider {
  readonly provider = 'mock' as const;
  constructor(readonly model: MockModel = 'v1') {}

  async analyze(input: AiAnalysisInput): Promise<unknown> {
    // Como um provedor real: devolve a resposta serializada; quem valida é o service.
    return JSON.stringify(mockAnalysis(input.text, this.model));
  }
}
