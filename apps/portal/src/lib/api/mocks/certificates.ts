/**
 * Mock de certificates (dono: lote B). Mesmo contrato de endpoints/certificates.ts, com dados fictícios
 * convertidos de mocks/data/design.ts (AT). Erros no formato da api (mockFail): 403 (análise só do rh),
 * 404 fora do escopo, 409 `STATUS_INVALIDO` (atestado já decidido, mesmo código do back), 400 modelo inválido.
 *
 * Forma por papel: rh recebe CertificateRh (médico, link do arquivo); os demais recebem Certificate.
 * O arquivo é sempre um Blob de texto de demonstração (nunca uma imagem real). O CID só vem para o rh.
 */
import type {
  AnalysisComparison, AnalysisFinding, AnalyzeCertificateResult, Certificate, CertificateAnalysis, CertificateRh, CheckedField, CidFinding,
  EntityId, RiskLevel,
} from '../contracts';
import { ANALYSIS_PROVIDERS } from '../contracts';
import type { CertificatesApi } from '../endpoints/certificates';
import { systemClock } from '../../clock';
import { mockCurrentRole } from './index';
import { clone, delay, matchesQuery, mockFail, mockId, mockNotFound, paginate, useMocks } from './runtime';
import { seedEmployee } from './seed';

/** Mesmo texto do back (certificate-analysis/rules/weights.ts, ANALYSIS_NOTICE). */
const NOTICE =
  'Análise automática e indicativa: confere só a completude e a coerência do texto do atestado. ' +
  'Não comprova a autenticidade do documento nem substitui a decisão do RH.';

interface Stored {
  cert: CertificateRh;
}

const rhCert = (id: string, employeeId: string, startDate: string, days: number, sentAt: string, doctor: [string, string, string] | null): CertificateRh => ({
  id, employeeId, startDate, days, hours: null, status: 'pendente', sentAt, decidedAt: null,
  doctorName: doctor?.[0] ?? null, doctorCrm: doctor?.[1] ?? null, doctorCrmUf: doctor?.[2] ?? null,
  decisionReason: null, fileUrl: `/portal/certificates/${id}/file`,
});

function seedCertificates(): Stored[] {
  const joaquim = rhCert('5', '112', '2026-11-10', 5, '2026-11-12T12:20:00.000Z', ['Paulo Andrade', '9318', 'GO']);
  joaquim.status = 'aprovado';
  joaquim.decidedAt = '2026-11-12T15:00:00.000Z';
  const sebastiao = rhCert('6', '113', '2026-11-03', 1, '2026-11-10T16:05:00.000Z', ['Henrique Vasconcelos', '18442', 'GO']);
  sebastiao.status = 'recusado';
  sebastiao.decidedAt = '2026-11-11T14:00:00.000Z';
  sebastiao.decisionReason = 'Atestado duplicado';
  return [
    { cert: rhCert('1', '107', '2026-11-20', 2, '2026-11-21T11:14:00.000Z', ['Henrique Vasconcelos', '18442', 'GO']) },
    { cert: rhCert('2', '108', '2026-11-21', 1, '2026-11-21T10:40:00.000Z', null) },
    { cert: rhCert('3', '105', '2026-11-18', 3, '2026-11-20T20:02:00.000Z', ['Carla Menezes', '22910', 'GO']) },
    { cert: rhCert('4', '106', '2026-11-14', 1, '2026-11-20T00:47:00.000Z', null) },
    { cert: joaquim },
    { cert: sebastiao },
  ];
}

const field = (item: CheckedField['item'], status: CheckedField['status'], evidence: string | null): CheckedField => ({ item, status, evidence });
const finding = (code: string, severity: AnalysisFinding['severity'], message: string): AnalysisFinding => ({ code, severity, message });
const cidOf = (code: string, chapter: string, chapterTitle: string): CidFinding => ({ code, chapter, chapterTitle, status: 'valido', confidence: 0.9, source: 'regra' });

interface SeedAnalysis {
  level: RiskLevel;
  score: number;
  reliability: [number, 'baixa' | 'media' | 'alta'];
  fields: CheckedField[];
  findings: AnalysisFinding[];
  cid: CidFinding;
  analyzedAt: string;
}

const SEED_ANALYSES: Record<string, SeedAnalysis> = {
  '1': {
    level: 'medio', score: 46, reliability: [58, 'media'], analyzedAt: '2026-11-21T11:20:00.000Z',
    fields: [
      field('data_atestado', 'ok', 'Data de emissão: 20/11/2026'),
      field('periodo_afastamento', 'ok', 'Afastamento de 2 dias, 20 e 21/11 (igual ao informado)'),
      field('profissional', 'ok', 'Henrique Vasconcelos, CRM-GO 18.442 (formato válido; carimbo e assinatura)'),
      field('legibilidade', 'ok', null),
    ],
    findings: [
      finding('RECORRENCIA_SEXTA', 'media', 'Recorrência em sextas-feiras: 3 afastamentos em sextas ou vésperas de feriado nos últimos 90 dias.'),
      finding('ENVIO_NO_PRAZO', 'baixa', 'Enviado no prazo: recebido 1 dia após a emissão. O prazo da empresa é de 2 dias.'),
    ],
    cid: cidOf('J11', 'X', 'Doenças do aparelho respiratório'),
  },
  '3': {
    level: 'baixo', score: 12, reliability: [72, 'alta'], analyzedAt: '2026-11-20T20:10:00.000Z',
    fields: [
      field('data_atestado', 'ok', 'Data de emissão: 18/11/2026'),
      field('periodo_afastamento', 'ok', 'Afastamento de 3 dias, 18 a 20/11 (igual ao informado)'),
      field('profissional', 'ok', 'Carla Menezes, CRM-GO 22.910 (formato válido)'),
      field('legibilidade', 'ok', null),
    ],
    findings: [finding('SEM_PONTOS_DE_ATENCAO', 'baixa', 'Sem pontos de atenção: todos os campos conferem com o cadastro e com a ausência declarada.')],
    cid: cidOf('M54.5', 'XIII', 'Doenças do sistema osteomuscular'),
  },
  '4': {
    level: 'alto', score: 81, reliability: [31, 'baixa'], analyzedAt: '2026-11-20T00:55:00.000Z',
    fields: [
      field('data_atestado', 'ok', 'Data de emissão: 14/11/2026'),
      field('periodo_afastamento', 'ok', '1 dia, 14/11'),
      field('profissional', 'ilegivel', 'CRM 4471 (sem UF; formato inválido); nome do médico ilegível'),
      field('legibilidade', 'ilegivel', 'Leitura fraca; assinatura não detectada'),
    ],
    findings: [
      finding('ENVIO_FORA_DO_PRAZO', 'alta', 'Enviado fora do prazo: recebido 5 dias após a emissão. O prazo da empresa é de 2 dias.'),
      finding('IMAGEM_SEMELHANTE', 'alta', 'Imagem semelhante a envio anterior: parecida com o atestado enviado em 02/10/2026.'),
      finding('CRM_FORMATO_INVALIDO', 'alta', 'CRM em formato inválido: não foi possível identificar a UF. Não há consulta a base externa.'),
    ],
    cid: cidOf('R51', 'XVIII', 'Sintomas e sinais não classificados em outra parte'),
  },
  '5': {
    level: 'baixo', score: 8, reliability: [75, 'alta'], analyzedAt: '2026-11-12T12:30:00.000Z',
    fields: [
      field('data_atestado', 'ok', 'Data de emissão: 10/11/2026'),
      field('periodo_afastamento', 'ok', '5 dias, 10 a 14/11'),
      field('profissional', 'ok', 'Paulo Andrade, CRM-GO 9.318 (formato válido)'),
      field('legibilidade', 'ok', null),
    ],
    findings: [finding('AFASTAMENTO_REGISTRADO', 'baixa', 'Afastamento registrado: os dias 10 a 14/11 foram abonados e recalculados.')],
    cid: cidOf('S93.4', 'XIX', 'Lesões, envenenamento e outras consequências de causas externas'),
  },
  '6': {
    level: 'alto', score: 74, reliability: [44, 'media'], analyzedAt: '2026-11-10T16:15:00.000Z',
    fields: [
      field('data_atestado', 'ok', 'Data de emissão: 03/11/2026'),
      field('periodo_afastamento', 'ok', '1 dia, 03/11'),
      field('profissional', 'ok', 'Henrique Vasconcelos, CRM-GO 18.442'),
      field('legibilidade', 'ok', null),
    ],
    findings: [finding('ATESTADO_DUPLICADO', 'alta', 'Atestado duplicado: mesmo médico e data de um atestado já registrado para outro período.')],
    cid: cidOf('K52.9', 'XI', 'Doenças do aparelho digestivo'),
  },
};

function buildAnalysis(certificateId: string, s: SeedAnalysis): CertificateAnalysis {
  return {
    id: mockId(), certificateId, provider: 'regras', model: null, promptVersion: null, rulesVersion: 'regras-v1', inputHash: null,
    analyzedAt: s.analyzedAt, responseMs: 40, notice: NOTICE, warnings: [], recommendation: 'revisar_manual',
    ai: { status: 'nao_executada', failure: null },
    checkedFields: s.fields, possibilities: [], cid: [s.cid],
    risk: { score: s.score, level: s.level, findings: s.findings },
    reliability: { score: s.reliability[0], band: s.reliability[1], cap: 50 },
  };
}

let store: Stored[] = seedCertificates();
let analyses: CertificateAnalysis[] = [];

const seedAnalyses = () => Object.entries(SEED_ANALYSES).map(([id, s]) => buildAnalysis(id, s));
analyses = seedAnalyses();

/** Volta o "banco" do mock ao estado do design (testes). */
export function resetMockCertificates() {
  store = seedCertificates();
  analyses = seedAnalyses();
}

const asRole = (c: CertificateRh): Certificate | CertificateRh => {
  if (mockCurrentRole() === 'rh') return clone(c);
  const { id, employeeId, startDate, days, hours, status, sentAt, decidedAt } = c;
  return { id, employeeId, startDate, days, hours, status, sentAt, decidedAt };
};

const find = (id: EntityId) => {
  const s = store.find((x) => x.cert.id === id);
  if (!s) throw mockNotFound();
  return s;
};

const requireRh = () => {
  if (mockCurrentRole() !== 'rh') throw mockFail(403, 'FORBIDDEN', 'Sem permissão para esta ação');
};

/** Só os modelos que o ambiente "tem": mock:v1 e mock:v2 (como `available()` do back). */
const MOCK_MODELS = ['v1', 'v2'];

function parseModels(models: string[] | undefined): { provider: 'mock'; model: string }[] {
  const specs = models && models.length > 0 ? models : ['mock:v1'];
  return specs.map((spec) => {
    const i = spec.indexOf(':');
    const provider = i < 0 ? spec : spec.slice(0, i);
    const model = i < 0 ? '' : spec.slice(i + 1);
    const known = (ANALYSIS_PROVIDERS as readonly string[]).includes(provider) && provider !== 'regras';
    if (!known || model.length === 0) throw mockFail(400, 'MODELO_INVALIDO', 'Modelo inválido: use provedor:modelo');
    if (provider !== 'mock' || !MOCK_MODELS.includes(model)) throw mockFail(400, 'MODELO_INDISPONIVEL', 'Modelo não configurado neste ambiente (no mock, só mock:v1 e mock:v2)');
    return { provider: 'mock' as const, model };
  });
}

function fakeAnalysis(certificateId: string, text: string, model: string): CertificateAnalysis {
  const score = 15 + ((text.length + model.length * 7) % 60);
  const level: RiskLevel = score < 34 ? 'baixo' : score < 67 ? 'medio' : 'alto';
  const base = buildAnalysis(certificateId, {
    level, score, reliability: [60, 'media'], analyzedAt: systemClock.now().toISOString(),
    fields: [
      field('data_atestado', 'ok', 'Data localizada no texto'),
      field('periodo_afastamento', 'ok', 'Período localizado no texto'),
      field('profissional', 'ok', 'Profissional e registro localizados'),
      field('legibilidade', 'ok', null),
    ],
    findings: [finding('SIMULACAO', 'baixa', 'Resultado simulado pelo mock do portal.')],
    cid: cidOf('Z00', 'XXI', 'Fatores que influenciam o estado de saúde'),
  });
  return { ...base, provider: 'mock', model, promptVersion: 'v1', warnings: ['IA_SIMULADA'], ai: { status: 'concluida', failure: null }, responseMs: 120 + model.length * 30 };
}

function compare(list: CertificateAnalysis[]): AnalysisComparison | null {
  if (list.length < 2) return null;
  const key = (a: CertificateAnalysis) => `${a.provider}:${a.model ?? ''}`;
  const levels = Object.fromEntries(list.map((a) => [key(a), a.risk.level]));
  const same = new Set(Object.values(levels)).size === 1;
  return {
    agreementByField: { data_atestado: 1, periodo_afastamento: 1, profissional: 1, nivel_de_risco: same ? 1 : 0.5 },
    divergences: same ? [] : [{ field: 'nivel_de_risco', values: levels }],
    responseMs: Object.fromEntries(list.map((a) => [key(a), a.responseMs])),
  };
}

export const mockCertificatesApi: CertificatesApi = {
  list: async (q) => {
    await delay();
    const rows = store
      .map((s) => s.cert)
      .filter((c) => (!q.status || c.status === q.status) && (!q.employeeId || c.employeeId === q.employeeId) && matchesQuery(q.q, seedEmployee(c.employeeId)?.name, seedEmployee(c.employeeId)?.registrationNumber))
      .sort((a, b) => b.sentAt.localeCompare(a.sentAt))
      .map(asRole);
    return paginate(rows, q);
  },
  file: async (id) => {
    await delay();
    requireRh();
    find(id);
    return new Blob(['arquivo de demonstração'], { type: 'text/plain' });
  },
  approve: async (id) => {
    await delay();
    requireRh();
    const s = find(id);
    if (s.cert.status !== 'pendente') throw mockFail(409, 'STATUS_INVALIDO', 'O atestado já foi decidido');
    s.cert.status = 'aprovado';
    s.cert.decidedAt = systemClock.now().toISOString();
    return asRole(s.cert);
  },
  reject: async (id, body) => {
    await delay();
    requireRh();
    const reason = body.reason.trim();
    if (reason.length < 3 || reason.length > 500) throw mockFail(422, 'VALIDATION_ERROR', 'Dados inválidos', [{ path: 'reason', message: 'O motivo deve ter de 3 a 500 caracteres' }]);
    const s = find(id);
    if (s.cert.status !== 'pendente') throw mockFail(409, 'STATUS_INVALIDO', 'O atestado já foi decidido');
    s.cert.status = 'recusado';
    s.cert.decidedAt = systemClock.now().toISOString();
    s.cert.decisionReason = reason;
    return asRole(s.cert);
  },
  analyze: async (id, body): Promise<AnalyzeCertificateResult> => {
    await delay(useMocks() ? 900 : 0);
    requireRh();
    const s = find(id);
    if (s.cert.status !== 'pendente') throw mockFail(409, 'STATUS_INVALIDO', 'O atestado já foi decidido');
    if (body.text.length < 20 || body.text.length > 20_000) throw mockFail(422, 'VALIDATION_ERROR', 'Dados inválidos', [{ path: 'text', message: 'O texto deve ter de 20 a 20.000 caracteres' }]);
    const created = parseModels(body.models).map((m) => fakeAnalysis(id, body.text, m.model));
    analyses = [...analyses, ...created];
    // A análise só sugere: o status do atestado não muda.
    return { certificateId: id, certificateStatus: s.cert.status, analyses: clone(created), comparison: compare(created) };
  },
  analyses: async (id) => {
    await delay();
    requireRh();
    find(id);
    return clone(analyses.filter((a) => a.certificateId === id).sort((a, b) => b.analyzedAt.localeCompare(a.analyzedAt)));
  },
};
