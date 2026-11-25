/**
 * Mocks da sessão e dos dados transversais (dono: orquestrador). Os módulos de tela têm o próprio
 * arquivo em mocks/<modulo>.ts. Dados fictícios, copiados do design.
 *
 * Sessão de mock: o login aceita qualquer senha e escolhe o papel pelo início do e-mail
 * (`rh@`, `admin@`, `gestor@`, `contador@`, `colaborador@`, `superadmin@`: sem conta, 2FA já ativo). E-mail com `2fa` pede o código 123456.
 * O papel fica em sessionStorage só no modo mock (não é dado sensível); some ao fechar a aba.
 */
import type { AuthApi } from '../endpoints/auth';
import type { OrgApi } from '../endpoints/org';
import type { OverviewApi } from '../endpoints/overview';
import type { Establishment, Me, OrgUnit, Overview, Role } from '../contracts';
import { clone, delay, mockFail } from './runtime';

export { useMocks } from './runtime';

export const MOCK_SESSION_KEY = 'genus.mock.session';
export const MOCK_TOTP_CODE = '123456';

const BASE_ME: Me = {
  id: '1', tenantId: '1', employeeId: null, name: 'Lúcia Martins', email: 'lucia@exemplo.test',
  role: 'rh', mfaEnabled: false, establishmentScope: null, authenticatedVia: 'cookie',
};

const MOCK_USERS: Record<Role, Partial<Me>> = {
  super_admin: { id: '900', tenantId: null, name: 'Operação Genus', email: 'superadmin@exemplo.test', role: 'super_admin', mfaEnabled: true },
  rh: {},
  admin: { id: '2', name: 'Paulo Andrade', email: 'admin@exemplo.test', role: 'admin' },
  gestor: { id: '3', name: 'Renata Lopes', email: 'gestor@exemplo.test', role: 'gestor', establishmentScope: ['1'] },
  contador: { id: '4', name: 'Marcos Teixeira', email: 'contador@exemplo.test', role: 'contador' },
  colaborador: { id: '5', name: 'João Pereira', email: 'colaborador@exemplo.test', role: 'colaborador', employeeId: '101', establishmentScope: ['1'] },
};

/** `me` padrão dos testes e do primeiro carregamento (RH, conta inteira). */
export const mockMe: Me = BASE_ME;

export const mockMeFor = (role: Role): Me => ({ ...BASE_ME, ...MOCK_USERS[role] });

const storage = () => (typeof window === 'undefined' ? null : window.sessionStorage);

export function readSession(): { role: Role; pending2fa: boolean } | null {
  const raw = storage()?.getItem(MOCK_SESSION_KEY);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { role?: string; pending2fa?: boolean };
    return v.role && v.role in MOCK_USERS ? { role: v.role as Role, pending2fa: Boolean(v.pending2fa) } : null;
  } catch {
    return null;
  }
}

const writeSession = (v: { role: string; pending2fa: boolean } | null) =>
  v ? storage()?.setItem(MOCK_SESSION_KEY, JSON.stringify(v)) : storage()?.removeItem(MOCK_SESSION_KEY);

export const mockAuthApi: AuthApi = {
  me: async () => {
    await delay(150);
    const s = readSession();
    if (!s || s.pending2fa) throw mockFail(401, 'UNAUTHENTICATED', 'Sessão expirada');
    return clone(mockMeFor(s.role));
  },
  signIn: async (email) => {
    await delay(400);
    const prefix = email.split('@')[0]?.replace(/2fa/g, '').replace(/^superadmin$/, 'super_admin') as Role;
    // Mensagem genérica: não revela se o e-mail existe.
    if (!(prefix in MOCK_USERS)) throw mockFail(401, 'INVALID_EMAIL_OR_PASSWORD', 'E-mail ou senha incorretos');
    const needs2fa = email.includes('2fa');
    writeSession({ role: prefix, pending2fa: needs2fa });
    return { twoFactorRequired: needs2fa };
  },
  verifyTotp: async (code) => {
    await delay(300);
    const s = readSession();
    if (!s) throw mockFail(401, 'UNAUTHENTICATED', 'Sessão expirada');
    if (code !== MOCK_TOTP_CODE) throw mockFail(401, 'INVALID_TWO_FACTOR_CODE', 'Código inválido');
    writeSession({ role: s.role, pending2fa: false });
  },
  signOut: async () => {
    await delay(100);
    writeSession(null);
  },
};

export const mockEstablishments: Establishment[] = [
  { id: '1', name: 'Fazenda Santa Helena', subtitle: 'Agropecuária Santa Helena Ltda', isActive: true },
  { id: '2', name: 'Usina Boa Vista', subtitle: 'Usina Boa Vista S.A.', isActive: true },
  { id: '3', name: 'Granja São José', subtitle: 'Granja São José Avicultura Ltda', isActive: true },
];

export const DEPARTMENTS = ['Colheita', 'Ordenha', 'Agroindústria', 'Manutenção', 'Administrativo', 'Armazém'];
export const JOB_TITLES = ['Operador de colhedora', 'Ordenhadora', 'Trabalhador rural', 'Auxiliar de produção', 'Mecânico', 'Tratorista', 'Assistente administrativa', 'Eletricista', 'Conferente'];

const units = (names: string[], establishmentId: string, base: number): OrgUnit[] =>
  names.map((name, i) => ({ id: String(base + i), establishmentId, name }));

export const mockDepartments = (establishmentId: string) => units(DEPARTMENTS, establishmentId, 10);
export const mockJobTitles = (establishmentId: string) => units(JOB_TITLES, establishmentId, 30);

export const mockOrgApi: OrgApi = {
  establishments: async () => {
    await delay(150);
    return clone(mockEstablishments);
  },
  departments: async (establishmentId) => {
    await delay();
    return mockDepartments(establishmentId);
  },
  jobTitles: async (establishmentId) => {
    await delay();
    return mockJobTitles(establishmentId);
  },
  costCenters: async (establishmentId) => {
    await delay();
    return units(['CC 100 · Campo', 'CC 200 · Oficina', 'CC 300 · Escritório'], establishmentId, 50);
  },
};

export const mockOverview: Overview = {
  kpis: [
    { key: 'workedHours', label: 'Horas trabalhadas', value: '18.432', unit: 'h', delta: '3,1%', trend: 'up', tone: 'good', comparison: 'vs. 17.878 h em 1 a 21 de out.' },
    { key: 'overtimeHours', label: 'Horas extras', value: '1.126', unit: 'h', delta: '12,4%', trend: 'up', tone: 'warn', comparison: 'vs. 1.002 h no período anterior' },
    { key: 'absences', label: 'Faltas', value: '37', unit: 'dias', delta: '17,8%', trend: 'down', tone: 'good', comparison: 'vs. 45 no período anterior' },
    { key: 'pendingCertificates', label: 'Atestados pendentes', value: '9', unit: '', delta: '+3', trend: 'up', tone: 'warn', comparison: '4 há mais de 2 dias na fila' },
    { key: 'activeVacations', label: 'Férias em curso', value: '14', unit: 'pessoas', delta: '+2', trend: 'up', tone: 'neutral', comparison: 'de 412 colaboradores ativos' },
  ],
  alerts: [
    { id: 'a1', severity: 'alerta', title: 'Marcações ímpares em Colheita', text: '6 colaboradores sem saída registrada ontem. Revise antes do fechamento de 30/11.', cta: 'Revisar marcações', target: 'apuracao' },
    { id: 'a2', severity: 'alerta', title: 'Interjornada menor que 11 h', text: '3 ocorrências em Manutenção nesta semana.', cta: 'Ver ocorrências', target: 'apuracao' },
    { id: 'a3', severity: 'sinal', title: 'Jornada de 42 h a partir de 16/12', text: '18 escalas ficam acima do novo limite semanal. Ajuste antes da vigência.', cta: 'Revisar escalas', target: 'escalas' },
    { id: 'a4', severity: 'sinal', title: 'Lote offline sincronizado', text: 'O coletor do Talhão 7 enviou 214 marcações de 19 e 20/11. Os dias foram recalculados.', cta: 'Ver apuração', target: 'apuracao' },
  ],
};

export const mockOverviewApi: OverviewApi = {
  get: async () => {
    await delay(350);
    return clone(mockOverview);
  },
};

/** Papel da sessão de mock (para o mock imitar o que a api esconde por papel, ex.: CPF mascarado). */
export const mockCurrentRole = (): Role => readSession()?.role ?? 'rh';
