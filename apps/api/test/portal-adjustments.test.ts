/**
 * Área 3: ajustes de marcação, afastamentos e decisão de atestado (G5, G7),
 * contra Postgres real do RH e do arp.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BASE_URL, FixedClock, PortalHarness, type Org } from './support/portal';
import { fakePdf, multipart } from './support/multipart';

const h = new PortalHarness({ arp: true, clock: new FixedClock('2026-11-24T12:00:00Z') });
let org: Org;
let rh: { userId: number; cookie: string };
let rh2: string;
let scheduleId: number;
let nsr = 0;

const local = (date: string, hhmm: string) => {
  const [hh, mm] = hhmm.split(':').map(Number) as [number, number];
  return new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), hh + 3, mm)).toISOString();
};

async function employeeOnSchedule(o = org, cookie = rh.cookie, sid = scheduleId) {
  const emp = await h.createEmployee(o);
  expect((await h.call(cookie, 'POST', `/portal/employees/${emp.id}/schedules`, { scheduleId: sid, validFrom: '2026-10-01' })).statusCode).toBe(201);
  return emp;
}

const fiveByTwo = (establishmentId: number) => ({
  establishmentId,
  name: '5x2',
  type: '5x2',
  cycleType: 'semanal',
  weeklyMinutes: 2400,
  days: [1, 2, 3, 4, 5].map((position) => ({ position, startTime: '07:00', endTime: '16:00', breakStartTime: '11:00', breakEndTime: '12:00' })),
});

async function closeOctober(o: Org, userId: number) {
  await h.client.query(
    `INSERT INTO rh.fechamentos (conta_id, estabelecimento_id, competencia, data_inicio, data_fim, status, fechado_por, fechado_em)
     VALUES ($1, $2, '2026-10-01', '2026-10-01', '2026-10-31', 'fechado', $3, now())`,
    [o.tenantId, o.establishmentId, userId],
  );
}

beforeAll(async () => {
  await h.start();
  await h.seedLegalParameters();
  org = await h.createOrg();
  rh = await h.loginAs(org, 'rh');
  rh2 = (await h.loginAs(org, 'rh')).cookie;
  scheduleId = (await h.call(rh.cookie, 'POST', '/portal/schedules', fiveByTwo(org.establishmentId))).json().data.id;
});
afterAll(() => h.stop());

describe('ajustes de marcação', () => {
  it('inclusão de batida aprovada vira marcação tratada e resolve a batida ímpar', async () => {
    const emp = await employeeOnSchedule();
    for (const t of ['07:00', '11:00', '12:00']) {
      nsr += 1;
      await h.insertArpPunch({ tenantId: org.tenantId, establishmentId: org.establishmentId, nsr, cpf: emp.cpf, at: local('2026-11-23', t) });
    }
    const before = (await h.call(rh.cookie, 'POST', `/portal/employees/${emp.id}/timesheets/recalculate`, { from: '2026-11-23', to: '2026-11-23' })).json();
    expect(before.data.days[0].status).toBe('inconsistente');

    const created = await h.call(rh.cookie, 'POST', `/portal/employees/${emp.id}/adjustments`, {
      date: '2026-11-23',
      type: 'inclusao_batida',
      proposedAt: local('2026-11-23', '16:00'),
      reason: 'Esqueceu de bater a saída',
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().data.status).toBe('pendente');

    const approved = await h.call(rh2, 'POST', `/portal/adjustments/${created.json().data.id}/approve`, {});
    expect(approved.statusCode).toBe(200);
    expect(approved.json().data.status).toBe('aprovado');

    const day = (await h.call(rh.cookie, 'GET', `/portal/employees/${emp.id}/timesheets?from=2026-11-23&to=2026-11-23`)).json().data[0];
    expect(day.status).toBe('calculada');
    expect(day.workedMinutes).toBe(480);
    expect(day.punches.map((p: { origin: string }) => p.origin)).toEqual(['original', 'original', 'original', 'tratada']);
    // a marcação original continua no arp, intocada
    const audit = await h.one<{ n: string }>("SELECT count(*) AS n FROM rh.auditorias WHERE entidade = 'ajustes' AND acao = 'aprovacao' AND entidade_id = $1", [created.json().data.id]);
    expect(Number(audit.n)).toBe(1);
  });

  it('quem pediu não aprova (409 DECISOR_IGUAL_SOLICITANTE); decidido não decide de novo (409 STATUS_INVALIDO)', async () => {
    const emp = await employeeOnSchedule();
    const id = (await h.call(rh.cookie, 'POST', `/portal/employees/${emp.id}/adjustments`, { date: '2026-11-20', type: 'justificativa', reason: 'Consulta médica' })).json().data.id;
    const self = await h.call(rh.cookie, 'POST', `/portal/adjustments/${id}/approve`, {});
    expect(self.statusCode).toBe(409);
    expect(self.json().code).toBe('DECISOR_IGUAL_SOLICITANTE');
    expect((await h.call(rh2, 'POST', `/portal/adjustments/${id}/reject`, {})).statusCode).toBe(400);
    expect((await h.call(rh2, 'POST', `/portal/adjustments/${id}/reject`, { reason: 'Sem comprovante' })).json().data.status).toBe('recusado');
    const again = await h.call(rh2, 'POST', `/portal/adjustments/${id}/approve`, {});
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('STATUS_INVALIDO');
  });

  it('validação: inclusão sem horário → 400; admin e contador não decidem → 403', async () => {
    const emp = await employeeOnSchedule();
    const bad = await h.call(rh.cookie, 'POST', `/portal/employees/${emp.id}/adjustments`, { date: '2026-11-20', type: 'inclusao_batida', reason: 'Sem hora' });
    expect(bad.statusCode).toBe(400);
    const id = (await h.call(rh.cookie, 'POST', `/portal/employees/${emp.id}/adjustments`, { date: '2026-11-20', type: 'abono', reason: 'Abono do dia' })).json().data.id;
    for (const role of ['admin', 'contador'] as const) {
      const { cookie } = await h.loginAs(org, role);
      expect((await h.call(cookie, 'POST', `/portal/adjustments/${id}/approve`, {})).statusCode, role).toBe(403);
    }
  });

  it('período fechado → 409 PERIODO_FECHADO (trigger do banco)', async () => {
    const o = await h.createOrg();
    const rhO = await h.loginAs(o, 'rh');
    const emp = await h.createEmployee(o);
    await closeOctober(o, rhO.userId);
    const res = await h.call(rhO.cookie, 'POST', `/portal/employees/${emp.id}/adjustments`, { date: '2026-10-15', type: 'justificativa', reason: 'Fora do prazo' });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('PERIODO_FECHADO');
  });

  it('colaborador pede o próprio ajuste (o id do corpo é ignorado) e não lista os ajustes (403)', async () => {
    const emp = await employeeOnSchedule();
    const other = await h.createEmployee(org);
    const colab = (await h.loginAs(org, 'colaborador', { employeeId: emp.id })).cookie;
    const res = await h.call(colab, 'POST', '/portal/me/adjustments', { date: '2026-11-20', type: 'justificativa', reason: 'Trânsito parado', employeeId: other.id });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.employeeId).toBe(emp.id);
    expect((await h.call(colab, 'GET', '/portal/adjustments')).statusCode).toBe(403);
    expect((await h.call(colab, 'POST', `/portal/adjustments/${res.json().data.id}/approve`, {})).statusCode).toBe(403);
  });

  it('rh com escopo de outro estabelecimento não vê nem decide (404)', async () => {
    const emp = await employeeOnSchedule();
    const id = (await h.call(rh.cookie, 'POST', `/portal/employees/${emp.id}/adjustments`, { date: '2026-11-20', type: 'justificativa', reason: 'Motivo qualquer' })).json().data.id;
    const scoped = (await h.loginAs(org, 'rh', { establishments: [org.otherEstablishmentId] })).cookie;
    expect((await h.call(scoped, 'POST', `/portal/adjustments/${id}/approve`, {})).statusCode).toBe(404);
    const list = (await h.call(scoped, 'GET', '/portal/adjustments')).json();
    expect(list.data.some((a: { id: number }) => a.id === id)).toBe(false);
  });

  it('gestor ligado: decide a justificativa da equipe; abono não (403); fora da equipe → 404', async () => {
    const boss = await h.createEmployee(org);
    const team = await h.createEmployee(org, { managerId: boss.id });
    const outsider = await h.createEmployee(org);
    const appOn = await h.newApp({ gestorEnabled: true });
    try {
      const gestor = (await h.loginAs(org, 'gestor', { employeeId: boss.id, app: appOn })).cookie;
      const mk = async (employeeId: number, type: string) =>
        (await h.call(rh.cookie, 'POST', `/portal/employees/${employeeId}/adjustments`, { date: '2026-11-20', type, reason: 'Pedido da equipe' })).json().data.id;
      const just = await mk(team.id, 'justificativa');
      const abono = await mk(team.id, 'abono');
      const out = await mk(outsider.id, 'justificativa');
      expect((await h.call(gestor, 'POST', `/portal/adjustments/${just}/approve`, {}, appOn)).statusCode).toBe(200);
      expect((await h.call(gestor, 'POST', `/portal/adjustments/${abono}/approve`, {}, appOn)).statusCode).toBe(403);
      expect((await h.call(gestor, 'POST', `/portal/adjustments/${out}/approve`, {}, appOn)).statusCode).toBe(404);
      // desligado: 403
      expect((await h.call(gestor, 'GET', '/portal/adjustments')).statusCode).toBe(403);
    } finally {
      await appOn.close();
    }
  });
});

describe('afastamentos', () => {
  it('rh registra; sobreposição → 409 AFASTAMENTO_SOBREPOSTO; o dia apurado vira afastamento', async () => {
    const emp = await employeeOnSchedule();
    await h.call(rh.cookie, 'POST', `/portal/employees/${emp.id}/timesheets/recalculate`, { from: '2026-11-16', to: '2026-11-16' });
    const res = await h.call(rh.cookie, 'POST', `/portal/employees/${emp.id}/absences`, { type: 'casamento', startDate: '2026-11-16', endDate: '2026-11-18' });
    expect(res.statusCode).toBe(201);
    const day = (await h.call(rh.cookie, 'GET', `/portal/employees/${emp.id}/timesheets?from=2026-11-16&to=2026-11-16`)).json().data[0];
    expect(day.situation).toBe('afastamento');
    const dup = await h.call(rh.cookie, 'POST', `/portal/employees/${emp.id}/absences`, { type: 'outro', startDate: '2026-11-18', endDate: '2026-11-19' });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe('AFASTAMENTO_SOBREPOSTO');
  });

  it('tipo atestado direto → 400; fim antes do início → 400; admin consulta mas não registra; fechado → 409', async () => {
    const emp = await employeeOnSchedule();
    expect((await h.call(rh.cookie, 'POST', `/portal/employees/${emp.id}/absences`, { type: 'atestado', startDate: '2026-11-16', endDate: '2026-11-16' })).statusCode).toBe(400);
    expect((await h.call(rh.cookie, 'POST', `/portal/employees/${emp.id}/absences`, { type: 'outro', startDate: '2026-11-16', endDate: '2026-11-15' })).statusCode).toBe(400);
    const admin = (await h.loginAs(org, 'admin')).cookie;
    expect((await h.call(admin, 'GET', `/portal/employees/${emp.id}/absences`)).statusCode).toBe(200);
    expect((await h.call(admin, 'POST', `/portal/employees/${emp.id}/absences`, { type: 'outro', startDate: '2026-11-16', endDate: '2026-11-16' })).statusCode).toBe(403);

    const o = await h.createOrg();
    const rhO = await h.loginAs(o, 'rh');
    const e2 = await h.createEmployee(o);
    await closeOctober(o, rhO.userId);
    const closed = await h.call(rhO.cookie, 'POST', `/portal/employees/${e2.id}/absences`, { type: 'outro', startDate: '2026-10-30', endDate: '2026-11-02' });
    expect(closed.statusCode).toBe(409);
    expect(closed.json().code).toBe('PERIODO_FECHADO');
  });
});

describe('atestados: envio, decisão e LGPD', () => {
  async function upload(cookie: string, data: Buffer, fields: Record<string, string> = { startDate: '2026-11-19', days: '2' }) {
    const body = multipart(fields, [{ field: 'file', filename: 'atestado.pdf', mime: 'application/pdf', data }]);
    return h.app.inject({ method: 'POST', url: '/portal/me/certificates', headers: { cookie, origin: BASE_URL, ...body.headers }, payload: body.payload });
  }

  it('colaborador envia: status pendente, hash SHA-256, mesmo arquivo de novo → 409; não-PDF → 400', async () => {
    const emp = await employeeOnSchedule();
    const colab = (await h.loginAs(org, 'colaborador', { employeeId: emp.id })).cookie;
    const pdf = fakePdf(`a-${emp.id}`);
    const res = await upload(colab, pdf, { startDate: '2026-11-19', days: '2', doctorName: 'Dra. Fictícia', doctorCrm: '12345', doctorCrmUf: 'SP' });
    expect(res.statusCode).toBe(201);
    expect(res.json().data).toMatchObject({ status: 'pendente', startDate: '2026-11-19', days: 2 });
    expect(JSON.stringify(res.json())).not.toMatch(/"cid|hash|doctor/i);
    const row = await h.one<{ arquivo_hash: string; arquivo_url: string; cid_cifrado: Buffer | null }>(
      'SELECT arquivo_hash, arquivo_url, cid_cifrado FROM rh.atestados WHERE id = $1',
      [res.json().data.id],
    );
    expect(row.arquivo_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.arquivo_url).toBe(`contas/${org.tenantId}/atestados/${row.arquivo_hash}.pdf`);
    expect(row.cid_cifrado).toBeNull();
    expect(h.storage.files.has(row.arquivo_url)).toBe(true);

    const dup = await upload(colab, pdf);
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe('ATESTADO_DUPLICADO');
    const notPdf = await upload(colab, Buffer.from('texto qualquer'));
    expect(notPdf.statusCode).toBe(400);
    expect(notPdf.json().code).toBe('ARQUIVO_INVALIDO');
    const noDays = await upload(colab, fakePdf(`b-${emp.id}`), { startDate: '2026-11-19' });
    expect(noDays.statusCode).toBe(400);
  });

  it('admin vê "afastado" sem médico nem arquivo, não baixa e não aprova (403); nenhuma resposta tem CID', async () => {
    const emp = await employeeOnSchedule();
    const colab = (await h.loginAs(org, 'colaborador', { employeeId: emp.id })).cookie;
    const id = (await upload(colab, fakePdf(`c-${emp.id}`), { startDate: '2026-11-19', days: '1', doctorName: 'Dr. Fictício' })).json().data.id;
    const admin = (await h.loginAs(org, 'admin')).cookie;
    const list = await h.call(admin, 'GET', `/portal/certificates?employeeId=${emp.id}`);
    expect(list.statusCode).toBe(200);
    const item = list.json().data[0];
    expect(item).toMatchObject({ id, status: 'pendente', startDate: '2026-11-19', days: 1 });
    expect(item).not.toHaveProperty('doctorName');
    expect(item).not.toHaveProperty('fileUrl');
    expect(list.body).not.toMatch(/"cid/i);
    expect((await h.call(admin, 'GET', `/portal/certificates/${id}/file`)).statusCode).toBe(403);
    expect((await h.call(admin, 'POST', `/portal/certificates/${id}/approve`, {})).statusCode).toBe(403);
    expect((await h.call(admin, 'POST', `/portal/certificates/${id}/reject`, { reason: 'Admin não decide' })).statusCode).toBe(403);
  });

  it('rh baixa o arquivo (auditado como leitura sensível) e aprova: cria o afastamento do atestado', async () => {
    const emp = await employeeOnSchedule();
    const colab = (await h.loginAs(org, 'colaborador', { employeeId: emp.id })).cookie;
    const pdf = fakePdf(`d-${emp.id}`);
    const id = (await upload(colab, pdf, { startDate: '2026-11-19', days: '2' })).json().data.id;

    const rhList = (await h.call(rh.cookie, 'GET', `/portal/certificates?employeeId=${emp.id}`)).json().data[0];
    expect(rhList.fileUrl).toBe(`/portal/certificates/${id}/file`);
    expect(JSON.stringify(rhList)).not.toMatch(/"cid/i);
    const file = await h.call(rh.cookie, 'GET', `/portal/certificates/${id}/file`);
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toBe('application/pdf');
    expect(file.rawPayload.equals(pdf)).toBe(true);
    const read = await h.one<{ n: string }>("SELECT count(*) AS n FROM rh.auditorias WHERE entidade = 'atestados' AND entidade_id = $1 AND acao = 'leitura_sensivel'", [id]);
    expect(Number(read.n)).toBe(1);

    const ok = await h.call(rh.cookie, 'POST', `/portal/certificates/${id}/approve`, {});
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.status).toBe('aprovado');
    const abs = (await h.call(rh.cookie, 'GET', `/portal/employees/${emp.id}/absences`)).json().data;
    expect(abs).toEqual([expect.objectContaining({ type: 'atestado', startDate: '2026-11-19', endDate: '2026-11-20', certificateId: id })]);

    const mine = (await h.call(colab, 'GET', '/portal/me/certificates')).json().data;
    expect(mine).toEqual([expect.objectContaining({ id, status: 'aprovado' })]);
    expect(JSON.stringify(mine)).not.toMatch(/"cid|doctor|fileUrl/i);
  });

  it('um colaborador não vê o atestado do outro; rh de outra conta → 404', async () => {
    const a = await employeeOnSchedule();
    const b = await employeeOnSchedule();
    const colabA = (await h.loginAs(org, 'colaborador', { employeeId: a.id })).cookie;
    const colabB = (await h.loginAs(org, 'colaborador', { employeeId: b.id })).cookie;
    const id = (await upload(colabA, fakePdf(`e-${a.id}`))).json().data.id;
    expect((await h.call(colabB, 'GET', '/portal/me/certificates')).json().data).toEqual([]);
    expect((await h.call(colabB, 'GET', '/portal/certificates')).statusCode).toBe(403);
    const other = await h.createOrg();
    const rhOther = (await h.loginAs(other, 'rh')).cookie;
    expect((await h.call(rhOther, 'POST', `/portal/certificates/${id}/approve`, {})).statusCode).toBe(404);
    expect((await h.call(rhOther, 'GET', `/portal/certificates/${id}/file`)).statusCode).toBe(404);
  });
});
