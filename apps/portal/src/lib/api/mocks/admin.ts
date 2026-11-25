/**
 * Mock de admin (dono: lote I). Mesmo contrato de endpoints/admin.ts, com dados fictícios
 * convertidos de mocks/data/design.ts (usuários de exemplo) e da sessão de mock. Só leitura:
 * a prévia não cria usuário, não salva parâmetro e não cadastra feriado (aguarda o back).
 */
import type { AdminApi } from '../endpoints/admin';
import type { CompanySettings, Holiday, PortalUser } from '../contracts';
import { designOverview } from './data/design';
import { mockMeFor } from './index';
import { clone, delay } from './runtime';

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

/** Feriados nacionais de data fixa (mês-dia). Os móveis (Carnaval, Sexta-feira Santa, Corpus Christi) ficam de fora. */
const NATIONAL: { md: string; name: string }[] = [
  { md: '01-01', name: 'Confraternização Universal' },
  { md: '04-21', name: 'Tiradentes' },
  { md: '05-01', name: 'Dia do Trabalho' },
  { md: '09-07', name: 'Independência do Brasil' },
  { md: '10-12', name: 'Nossa Senhora Aparecida' },
  { md: '11-02', name: 'Finados' },
  { md: '11-15', name: 'Proclamação da República' },
  { md: '11-20', name: 'Consciência Negra' },
  { md: '12-25', name: 'Natal' },
];

/** O municipal só aparece no estabelecimento de Rio Verde (id '1' no mock). */
const RIO_VERDE_ESTABLISHMENT_ID = '1';

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
    const list: Holiday[] = NATIONAL.map((h, i) => ({ id: `h${year}-${i + 1}`, date: `${year}-${h.md}`, name: h.name, scope: 'nacional' }));
    if (establishmentId === RIO_VERDE_ESTABLISHMENT_ID) {
      // [A CONFIRMAR] data do feriado municipal de Rio Verde/GO: valor ilustrativo do mock, conferir com o RH da conta.
      list.push({ id: `h${year}-m1`, date: `${year}-08-05`, name: 'Aniversário de Rio Verde', scope: 'municipal' });
    }
    return list.sort((a, b) => a.date.localeCompare(b.date));
  },
};
