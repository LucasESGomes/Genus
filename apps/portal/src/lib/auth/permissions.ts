/**
 * Regras de exibição por perfil. Só controlam a tela: a api valida de novo e a tela trata o 403.
 * CID só para o RH (CLAUDE.md, LGPD). Admin nunca vê CID nem aprova atestado.
 */
import type { Role } from '../api/contracts';

export type Action = 'rh.panel' | 'certificate.viewCid' | 'certificate.approve' | 'employee.portal';

const RULES: Record<Action, readonly Role[]> = {
  'rh.panel': ['super_admin', 'admin', 'rh', 'gestor', 'contador'],
  'certificate.viewCid': ['rh'],
  'certificate.approve': ['rh'],
  'employee.portal': ['colaborador'],
};

export const can = (role: Role, action: Action) => RULES[action].includes(role);

export const SENSITIVE_PLACEHOLDER = 'Dado sensível restrito';

export const ROLE_LABEL: Record<Role, string> = {
  super_admin: 'Super admin', admin: 'Admin', rh: 'RH', gestor: 'Gestor', contador: 'Contador', colaborador: 'Colaborador',
};
