/**
 * Regras de exibição por perfil. Só controlam a tela (esconder/desabilitar): a api valida de novo
 * e a tela trata o 403/404. Espelham os `authorize(...)` de apps/api/src/modules/*\/routes.ts.
 * CID só para o RH (CLAUDE.md, LGPD). Admin nunca vê CID nem aprova atestado.
 * Gestor depende de PORTAL_GESTOR_ENABLED no back: desligado, a api devolve 403 e a tela mostra o estado 403.
 */
import type { Role } from '../api/contracts';

const RULES = {
  // Portais
  'rh.panel': ['admin', 'rh', 'gestor', 'contador'],
  'employee.portal': ['colaborador'],

  // Menu do painel (o que aparece na sidebar)
  'nav.overview': ['admin', 'rh', 'gestor'],
  'nav.employees': ['admin', 'rh', 'gestor', 'contador'],
  'nav.timesheets': ['admin', 'rh', 'gestor'],
  'nav.adjustments': ['rh', 'gestor'],
  'nav.vacations': ['admin', 'rh', 'gestor'],
  'nav.certificates': ['admin', 'rh', 'gestor'],
  'nav.timeBank': ['admin', 'rh', 'gestor'],
  'nav.closings': ['admin', 'rh', 'contador'],
  'nav.reports': ['admin', 'rh', 'contador'],
  'nav.devices': ['admin', 'rh'],
  'nav.settings': ['admin', 'rh'],
  'nav.schedules': ['admin', 'rh'],

  // Colaboradores (employees/routes.ts)
  'employee.create': ['rh'],
  'employee.edit': ['rh'],
  'employee.terminate': ['rh'],
  'employee.viewFullCpf': ['rh', 'admin'],
  /** [A CONFIRMAR] back: rh e admin (SALARY_ROLES); security-lgpd.md §1 diz "só RH". */
  'employee.viewSalary': ['rh', 'admin'],
  'assignment.view': ['rh', 'admin'],
  'assignment.edit': ['rh'],

  // Escalas (schedules/routes.ts)
  'schedule.view': ['rh', 'admin'],
  'schedule.edit': ['rh'],

  // Apuração (timesheets/routes.ts)
  'timesheet.view': ['rh', 'admin', 'gestor'],
  'timesheet.recalculate': ['rh'],

  // Ajustes (adjustments/routes.ts). Abono: só o RH decide (04 §5).
  'adjustment.create': ['rh'],
  'adjustment.decide': ['rh', 'gestor'],
  'adjustment.decideAllowance': ['rh'],

  // Afastamentos (absences/routes.ts)
  'absence.view': ['rh', 'admin', 'gestor'],
  'absence.create': ['rh'],

  // Atestados (certificates, certificate-analysis)
  'certificate.view': ['rh', 'admin', 'gestor'],
  'certificate.viewCid': ['rh'],
  'certificate.viewFile': ['rh'],
  'certificate.viewDoctor': ['rh'],
  'certificate.analyze': ['rh'],
  'certificate.approve': ['rh'],

  // Férias (vacations/routes.ts)
  'vacation.view': ['rh', 'admin', 'gestor'],
  'vacation.create': ['rh'],
  'vacation.decide': ['rh', 'gestor'],
  'vacation.cancel': ['rh'],

  // Fechamento (closing/routes.ts)
  'closing.view': ['rh', 'admin', 'contador'],
  'closing.manage': ['rh'],
  'closing.reopen': ['rh'],
  'closing.viewMirror': ['rh', 'admin', 'contador', 'gestor'],

  // [MOCK] sem back: Totens, Relatórios, Configurações, Banco de horas do RH
  'device.manage': ['rh', 'admin'],
  'report.generate': ['rh', 'admin', 'contador'],
  'settings.manage': ['rh', 'admin'],
  'timeBank.view': ['rh', 'admin', 'gestor'],
} as const satisfies Record<string, readonly Role[]>;

export type Action = keyof typeof RULES;

export const can = (role: Role, action: Action) => (RULES[action] as readonly Role[]).includes(role);

export const SENSITIVE_PLACEHOLDER = 'Dado sensível restrito';

export { ROLE_LABEL } from '../labels';

/** Primeira tela de cada perfil depois do login. `super_admin` não entra nos módulos de RH. */
export function homeFor(role: Role): string {
  if (role === 'colaborador') return '/me';
  if (role === 'contador') return '/rh/fechamento';
  if (can(role, 'rh.panel')) return '/rh';
  return '/sem-acesso';
}
