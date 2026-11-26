/**
 * Mock de admin (dono: lote I). Mesmo contrato de endpoints/admin.ts, com dados fictícios
 * convertidos de mocks/data/design.ts (usuários de exemplo) e da sessão de mock. Só leitura:
 * a prévia não cria usuário, não salva parâmetro e não cadastra feriado (aguarda o back).
 */
import type { AdminApi } from '../endpoints/admin';
import type { CompanySettings, Holiday, PortalUser } from '../contracts';
import { designOverview } from './data/design';
import { mockMeFor } from './index';
import type { EntityId } from '../contracts';
import { clone, delay, mockFail, mockNotFound } from './runtime';

const fromSession = (role: 'rh' | 'admin' | 'gestor' | 'contador' | 'colaborador', mfaEnabled: boolean): PortalUser => {
  const me = mockMeFor(role);
  return { id: me.id, name: me.name, email: me.email, role: me.role, establishmentScope: me.establishmentScope, mfaEnabled, isActive: true };
};

/** Nomes do design (`designOverview.usuarios`); e-mails sempre em `@exemplo.test`. */
const USERS: PortalUser[] = [
  { ...fromSession('rh', true), name: designOverview.usuarios.rh.nome },
  fromSession('admin', true),
  { id: '6', name: designOverview.usuarios.admin.nome, email: 'ricardo@exemplo.test', role: 'admin', establishmentScope: null, mfaEnabled: true, isActive: true },
  fromSession('gestor', false),
  fromSession('contador', false),
  { ...fromSession('colaborador', false), isActive: false },
];

const SETTINGS: CompanySettings = {
  managerPortalEnabled: false,
  maxSimultaneousVacationsPerDepartment: 2,
  punchToleranceMinutes: 10,
};

/** Feriados nacionais de data fixa (mês-dia). Os móveis entram como facultativos no back (migration 0021). */
const NATIONAL: { md: string; name: string }[] = [
  { md: '01-01', name: 'Confraternização Universal' },
  { md: '04-21', name: 'Tiradentes' },
  { md: '05-01', name: 'Dia do Trabalho' },
  { md: '09-07', name: 'Independência do Brasil' },
  { md: '10-12', name: 'Nossa Senhora Aparecida' },
  { md: '11-02', name: 'Finados' },
  { md: '11-15', name: 'Proclamação da República' },
  { md: '11-20', name: 'Dia Nacional de Zumbi e da Consciência Negra' },
  { md: '12-25', name: 'Natal' },
];

/** O municipal só aparece no estabelecimento de Rio Verde (id '1' no mock). */
const RIO_VERDE_ESTABLISHMENT_ID = '1';

const base = (h: Pick<Holiday, 'id' | 'date' | 'name'> & Partial<Holiday>): Holiday => ({
  scope: 'nacional', uf: null, municipalityIbge: null, isOptional: false, isOwn: false, isWorked: false, treatment: null, ...h,
});

/** Feriados da conta e regras por estabelecimento criados no modo mock. */
let own: (Holiday & { establishmentId: EntityId })[] = [];
const rules = new Map<string, { isWorked: boolean; treatment: Holiday['treatment'] }>();
let seq = 1;

function catalog(establishmentId: EntityId, year: number): Holiday[] {
  const list: Holiday[] = NATIONAL.map((h, i) => base({ id: `h${year}-${i + 1}`, date: `${year}-${h.md}`, name: h.name }));
  if (establishmentId === RIO_VERDE_ESTABLISHMENT_ID) {
    // [A CONFIRMAR] data do feriado municipal de Rio Verde/GO: valor ilustrativo do mock, conferir com o RH da conta.
    list.push(base({ id: `h${year}-m1`, date: `${year}-08-05`, name: 'Aniversário de Rio Verde', scope: 'municipal', uf: 'GO', municipalityIbge: '5218805' }));
  }
  const mine = own.filter((h) => h.date.startsWith(String(year)) && (h.scope === 'nacional' || h.establishmentId === establishmentId));
  return [...list, ...mine.map(({ establishmentId: _e, ...h }) => h)]
    .map((h) => ({ ...h, ...(rules.get(`${establishmentId}:${h.id}`) ?? {}) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export const mockAdminApi: AdminApi = {
  users: async () => {
    await delay();
    return clone(USERS);
  },
  companySettings: async () => {
    await delay();
    return clone(SETTINGS);
  },
  holidays: async (establishmentId, year) => {
    await delay();
    return clone(catalog(establishmentId, year));
  },
  createHoliday: async (body) => {
    await delay();
    if (own.some((h) => h.date === body.date && h.scope === body.scope)) throw mockFail(409, 'CONFLICT', 'Já existe esse feriado nessa data');
    const h = { ...base({ id: `own${seq++}`, date: body.date, name: body.name, scope: body.scope, isOptional: body.isOptional ?? false, isOwn: true }), establishmentId: body.establishmentId };
    own = [...own, h];
    const { establishmentId: _e, ...out } = h;
    return clone(out);
  },
  updateHoliday: async (id, body) => {
    await delay();
    const h = own.find((x) => x.id === id);
    if (!h) throw mockNotFound();
    Object.assign(h, body);
    const { establishmentId: _e, ...out } = h;
    return clone(out);
  },
  deleteHoliday: async (id) => {
    await delay();
    if (!own.some((x) => x.id === id)) throw mockNotFound();
    own = own.filter((x) => x.id !== id);
  },
  setEstablishmentHoliday: async (establishmentId, holidayId, body) => {
    await delay();
    const year = Number(holidayId.match(/^h(\d{4})/)?.[1] ?? own.find((x) => x.id === holidayId)?.date.slice(0, 4));
    const h = catalog(establishmentId, year).find((x) => x.id === holidayId);
    if (!h) throw mockNotFound();
    if (body.isWorked && !body.treatment) throw mockFail(400, 'VALIDATION_ERROR', 'Requisição inválida', [{ path: 'treatment', message: 'escolha o tratamento' }]);
    rules.set(`${establishmentId}:${holidayId}`, { isWorked: body.isWorked, treatment: body.isWorked ? (body.treatment ?? null) : null });
    return clone({ ...h, isWorked: body.isWorked, treatment: body.isWorked ? (body.treatment ?? null) : null });
  },
};
