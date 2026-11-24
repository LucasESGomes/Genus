/**
 * Análise de atestado com IA (G6, RF61–RF67, RN15) contra Postgres real:
 * permissão, 400/403/404/409, status do atestado intocado, duplicidade antes da
 * IA, falha da IA tratada (nunca 500), dado de saúde cifrado e fora do log.
 * Tudo fictício; a IA é a mock determinística ou um provedor falso.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CertificateAiRegistry, MOCK_ONLY_CONFIG, type ResolvedProvider } from '../src/modules/certificate-analysis/ai/registry';
import { AiProviderError, type AiAnalysisInput, type CertificateAiProvider } from '../src/modules/certificate-analysis/ai/provider';
import { MockCertificateAiProvider } from '../src/modules/certificate-analysis/ai/mock-provider';
import { BASE_URL, FixedClock, PortalHarness, type Org } from './support/portal';
import { fakePdf, multipart } from './support/multipart';

const h = new PortalHarness({ clock: new FixedClock('2026-11-23T12:00:00Z') });
let org: Org;
let rh: { userId: number; cookie: string };
let seq = 0;

/** Registro que devolve sempre o mesmo provedor, para espionar ou simular falha. */
class FixedRegistry extends CertificateAiRegistry {
  constructor(private readonly p: CertificateAiProvider) {
    super(MOCK_ONLY_CONFIG);
  }
  override default(): ResolvedProvider {
    return { provider: this.p, warnings: [] };
  }
}

class Spy implements CertificateAiProvider {
  readonly provider = 'mock' as const;
  readonly model = 'v1';
  readonly sent: string[] = [];
  constructor(private readonly fail?: AiProviderError) {}
  async analyze(input: AiAnalysisInput) {
    this.sent.push(input.text);
    if (this.fail) throw this.fail;
    return new MockCertificateAiProvider('v1').analyze(input);
  }
}

const textFor = (cpf: string, start = '18/11/2026', days = 2) =>
  [
    'ATESTADO MÉDICO',
    `Atesto que a paciente Pessoa Fictícia, CPF ${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}, necessita de ${days} (dois) dias de afastamento a partir de ${start}.`,
    'CID-10: J11.1',
    'Dra. Helena Duarte',
    'CRM-SP 123456',
    `Data: ${start}`,
  ].join('\n');

async function newCertificate(o = org, startDate = '2026-11-18', days = '2') {
  const emp = await h.createEmployee(o);
  const colab = (await h.loginAs(o, 'colaborador', { employeeId: emp.id })).cookie;
  const id = await upload(colab, startDate, days);
  return { emp, colab, id };
}

async function upload(colab: string, startDate: string, days: string): Promise<number> {
  seq += 1;
  const body = multipart({ startDate, days, doctorCrm: '123456', doctorCrmUf: 'SP' }, [
    { field: 'file', filename: 'atestado.pdf', mime: 'application/pdf', data: fakePdf(`analise-${seq}`) },
  ]);
  const res = await h.app.inject({ method: 'POST', url: '/portal/me/certificates', headers: { cookie: colab, origin: BASE_URL, ...body.headers }, payload: body.payload });
  expect(res.statusCode).toBe(201);
  return res.json().data.id as number;
}

const analyze = (cookie: string, id: number, payload: unknown, app = h.app) => h.call(cookie, 'POST', `/portal/certificates/${id}/analyze`, payload, app);

beforeAll(async () => {
  await h.start();
  org = await h.createOrg();
  rh = await h.loginAs(org, 'rh');
});
afterAll(() => h.stop());

describe('POST /portal/certificates/:id/analyze', () => {
  it('rh analisa: resposta no schema, com aviso e IA_SIMULADA; o atestado continua pendente e intocado', async () => {
    const { emp, id } = await newCertificate();
    const before = await h.one('SELECT * FROM rh.atestados WHERE id = $1', [id]);
    const res = await analyze(rh.cookie, id, { text: textFor(emp.cpf) });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data).toMatchObject({ certificateId: id, certificateStatus: 'pendente', comparison: null });
    const a = data.analyses[0];
    expect(a).toMatchObject({ provider: 'mock', model: 'v1', promptVersion: 'atestado-v1', recommendation: 'sem_recomendacao', ai: { status: 'concluida', failure: null } });
    expect(a.notice).toMatch(/Não comprova a autenticidade/);
    expect(a.warnings).toContain('IA_SIMULADA');
    expect(a.reliability.score).toBeLessThanOrEqual(90);
    expect(a.cid[0]).toMatchObject({ code: 'J11.1', chapter: 'X' });
    expect(a.checkedFields.map((f: { status: string }) => f.status)).toEqual(['ok', 'ok', 'ok', 'ok']);

    // IA nunca altera o status (nem nenhuma outra coluna) do atestado.
    expect(await h.one('SELECT * FROM rh.atestados WHERE id = $1', [id])).toEqual(before);
  });

  it('grava uma linha com modelo e hash; CID, texto e evidências só cifrados; nada disso em log nem na auditoria', async () => {
    const { emp, id } = await newCertificate();
    const text = textFor(emp.cpf);
    const analysisId = (await analyze(rh.cookie, id, { text })).json().data.analyses[0].id;
    const row = await h.one<Record<string, unknown>>('SELECT * FROM rh.analises_atestado WHERE id = $1', [analysisId]);
    expect(row).toMatchObject({ provedor: 'mock', modelo: 'v1', versao_prompt: 'atestado-v1', recomendacao: 'sem_recomendacao', falha: null, nota_risco: 'baixo' });
    expect((row.hash_entrada as Buffer).length).toBe(32);
    for (const col of ['cid_cifrado', 'ocr_texto_cifrado', 'evidencias_cifradas']) {
      const buf = row[col] as Buffer;
      expect(buf).toBeInstanceOf(Buffer);
      expect(buf.toString('latin1')).not.toMatch(/J11|Helena|CRM/);
    }
    const stored = JSON.stringify(row.resultado);
    expect(stored).not.toMatch(/J11|Helena|123456|Data:/);
    expect(stored).toContain('"checkedFields"');

    const audit = await h.one<{ dados_depois: Record<string, unknown> }>(
      "SELECT dados_depois FROM rh.auditorias WHERE entidade = 'atestados' AND entidade_id = $1 AND dados_depois->>'event' = 'certificate.analyzed'",
      [id],
    );
    expect(JSON.stringify(audit.dados_depois)).not.toMatch(/J11|Helena|Fictícia/);
    const logs = h.logLines.join('');
    expect(logs).not.toContain('Helena Duarte');
    expect(logs).not.toContain(emp.cpf);
    expect(logs).not.toContain('J11.1');
  });

  it('dois modelos: uma linha por modelo e comparação na resposta', async () => {
    const { emp, id } = await newCertificate();
    const res = await analyze(rh.cookie, id, { text: textFor(emp.cpf), models: ['mock:v1', 'mock:estrito'] });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.analyses.map((a: { model: string }) => a.model)).toEqual(['v1', 'estrito']);
    expect(data.comparison.agreementByField).toHaveProperty('profissional');
    expect(Object.keys(data.comparison.responseMs)).toEqual(['mock:v1', 'mock:estrito']);
    const rows = await h.one<{ n: string }>('SELECT count(*) AS n FROM rh.analises_atestado WHERE atestado_id = $1', [id]);
    expect(Number(rows.n)).toBe(2);
  });

  it('400 para entrada inválida', async () => {
    const { emp, id } = await newCertificate();
    for (const body of [{}, { text: 'curto' }, { text: textFor(emp.cpf), models: ['gpt'] }, { text: textFor(emp.cpf), models: ['mock:v1', 'mock:v1'] }]) {
      const res = await analyze(rh.cookie, id, body);
      expect(res.statusCode).toBe(400);
    }
    const unknown = await analyze(rh.cookie, id, { text: textFor(emp.cpf), models: ['anthropic:claude-haiku-5-5'] });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json().code).toBe('MODELO_IA_INVALIDO');
    expect((await h.call(rh.cookie, 'POST', '/portal/certificates/abc/analyze', { text: textFor(emp.cpf) })).statusCode).toBe(400);
  });

  it('403 sem permissão (admin, colaborador e gestor desligado); 404 fora da conta', async () => {
    const { emp, colab, id } = await newCertificate();
    const body = { text: textFor(emp.cpf) };
    const admin = (await h.loginAs(org, 'admin')).cookie;
    expect((await analyze(admin, id, body)).statusCode).toBe(403);
    expect((await analyze(colab, id, body)).statusCode).toBe(403);
    expect((await analyze((await h.loginAs(org, 'gestor')).cookie, id, body)).statusCode).toBe(403);
    expect((await h.call(admin, 'GET', `/portal/certificates/${id}/analyses`)).statusCode).toBe(403);

    const other = await h.createOrg();
    const rhOther = (await h.loginAs(other, 'rh')).cookie;
    expect((await analyze(rhOther, id, body)).statusCode).toBe(404);
  });

  it('409 para atestado já decidido', async () => {
    const { emp, id } = await newCertificate(org, '2026-11-10', '1');
    expect((await h.call(rh.cookie, 'POST', `/portal/certificates/${id}/approve`, {})).statusCode).toBe(200);
    const res = await analyze(rh.cookie, id, { text: textFor(emp.cpf, '10/11/2026', 1) });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('STATUS_INVALIDO');
  });

  it('duplicidade é barrada pela regra antes da IA', async () => {
    const spy = new Spy();
    const app = await h.newApp({ certificateAi: new FixedRegistry(spy) });
    const { emp, colab } = await newCertificate(org, '2026-11-02', '2');
    const second = await upload(colab, '2026-11-03', '2');
    const res = await analyze(rh.cookie, second, { text: textFor(emp.cpf, '03/11/2026') }, app);
    expect(res.statusCode).toBe(200);
    const a = res.json().data.analyses[0];
    expect(a).toMatchObject({ provider: 'regras', model: null, recommendation: 'revisar_manual', ai: { status: 'nao_executada' } });
    expect(a.risk.findings.map((f: { code: string }) => f.code)).toContain('atestado_duplicado');
    expect(spy.sent).toHaveLength(0);
    await app.close();
  });

  it('CPF e nome não chegam ao provedor', async () => {
    const spy = new Spy();
    const app = await h.newApp({ certificateAi: new FixedRegistry(spy) });
    const { emp, id } = await newCertificate(org, '2026-11-24', '2');
    expect((await analyze(rh.cookie, id, { text: textFor(emp.cpf, '24/11/2026') }, app)).statusCode).toBe(200);
    expect(spy.sent).toHaveLength(1);
    expect(spy.sent[0]).not.toMatch(/Pessoa|Fictícia/);
    expect(spy.sent[0]!.replace(/\D/g, '')).not.toContain(emp.cpf);
    await app.close();
  });

  it.each([
    ['provedor fora do ar', new AiProviderError('provedor_indisponivel', 'HTTP 503', 503)],
    ['saída fora do schema', new AiProviderError('saida_fora_do_schema', 'schema')],
  ])('%s: 200 com a falha tratada, nada da IA gravado, nunca 500', async (_l, error) => {
    const app = await h.newApp({ certificateAi: new FixedRegistry(new Spy(error)) });
    const { emp, id } = await newCertificate(org, '2026-12-01', '2');
    const res = await analyze(rh.cookie, id, { text: textFor(emp.cpf, '01/12/2026') }, app);
    expect(res.statusCode).toBe(200);
    const a = res.json().data.analyses[0];
    expect(a).toMatchObject({ ai: { status: 'falhou', failure: error.code }, recommendation: 'revisar_manual', checkedFields: [] });
    const row = await h.one<{ falha: string; resultado: Record<string, unknown>; evidencias_cifradas: Buffer | null }>(
      'SELECT falha, resultado, evidencias_cifradas FROM rh.analises_atestado WHERE id = $1',
      [a.id],
    );
    expect(row.falha).toBe(error.code);
    expect(row.resultado).not.toHaveProperty('checkedFields');
    expect(row.evidencias_cifradas).toBeNull();
    await app.close();
  });

  it('sem CERTIFICATE_DATA_KEY: analisa, avisa e não grava dado de saúde', async () => {
    const app = await h.newApp({ healthCipher: null });
    const { emp, id } = await newCertificate(org, '2026-12-05', '2');
    const a = (await analyze(rh.cookie, id, { text: textFor(emp.cpf, '05/12/2026') }, app)).json().data.analyses[0];
    expect(a.warnings).toContain('SEM_CHAVE_DADOS_SAUDE');
    const row = await h.one<Record<string, unknown>>('SELECT cid_cifrado, ocr_texto_cifrado, evidencias_cifradas FROM rh.analises_atestado WHERE id = $1', [a.id]);
    expect(row).toEqual({ cid_cifrado: null, ocr_texto_cifrado: null, evidencias_cifradas: null });
    const listed = (await h.call(rh.cookie, 'GET', `/portal/certificates/${id}/analyses`, undefined, app)).json().data[0];
    expect(listed.cid).toBeNull();
    expect(listed.warnings).toContain('SEM_CHAVE_DADOS_SAUDE');
    await app.close();
  });
});

describe('GET /portal/certificates/:id/analyses', () => {
  it('rh lê as análises com CID e evidências decifrados; a leitura é auditada', async () => {
    const { emp, id } = await newCertificate(org, '2026-12-10', '2');
    await analyze(rh.cookie, id, { text: textFor(emp.cpf, '10/12/2026') });
    const res = await h.call(rh.cookie, 'GET', `/portal/certificates/${id}/analyses`);
    expect(res.statusCode).toBe(200);
    const [a] = res.json().data;
    expect(a.cid[0]).toMatchObject({ code: 'J11.1', chapter: 'X' });
    expect(a.checkedFields.find((f: { item: string }) => f.item === 'profissional').evidence).toBe('CRM-SP 123456');
    expect(a.notice).toMatch(/indicativa/);
    const audit = await h.one<{ n: string }>(
      "SELECT count(*) AS n FROM rh.auditorias WHERE entidade_id = $1 AND acao = 'leitura_sensivel' AND dados_depois->>'event' = 'certificate.analyses_read'",
      [id],
    );
    expect(Number(audit.n)).toBe(1);
  });
});
