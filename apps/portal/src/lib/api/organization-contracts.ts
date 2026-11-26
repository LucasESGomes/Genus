/**
 * Empresas, estabelecimentos e convites (docs/prompts/mvp-superadmin-orquestracao.md, "Contratos").
 * IDs viram `EntityId` (string) na borda (lib/api/ids.ts). O CPF só aparece nos corpos de criação e de
 * aceite do convite: nunca em resposta, URL ou cache.
 */
import type { EntityId } from './contracts';

export const REGISTRATION_TYPES = ['CNPJ', 'CPF', 'CAEPF'] as const;
export type RegistrationType = (typeof REGISTRATION_TYPES)[number];

export interface CompanyEstablishment {
  id: EntityId;
  companyId: EntityId;
  name: string;
  registrationType: RegistrationType;
  registration: string;
  uf: string;
  municipalityIbge: string;
  isActive: boolean;
}
export interface Company {
  id: EntityId;
  legalName: string;
  cnpj: string;
  isActive: boolean;
  establishments: CompanyEstablishment[];
}
export interface CreateCompanyInput {
  legalName: string;
  cnpj: string;
}
export type UpdateCompanyInput = Partial<CreateCompanyInput> & { isActive?: boolean };
export type CreateEstablishmentInput = Pick<CompanyEstablishment, 'name' | 'registrationType' | 'registration' | 'uf' | 'municipalityIbge'>;
export type UpdateEstablishmentInput = Partial<CreateEstablishmentInput> & { isActive?: boolean };

// ---- convites
export const INVITE_ROLES = ['admin', 'rh'] as const;
export type InviteRole = (typeof INVITE_ROLES)[number];
export type InviteStatus = 'pendente' | 'aceito' | 'revogado' | 'expirado';

export interface Invite {
  id: EntityId;
  name: string;
  email: string;
  role: InviteRole;
  status: InviteStatus;
  expiresAt: string;
  createdAt: string;
  acceptedAt: string | null;
}
export interface CreateInviteInput {
  name: string;
  email: string;
  role: InviteRole;
  /** 11 dígitos. Só no corpo do POST. */
  cpf: string;
}
export interface CreatedInvite {
  invite: Invite;
  /** Devolvido uma vez; só vive no estado do diálogo que mostra o link. */
  token: string;
}
export interface InvitePreview {
  tenantName: string;
  name: string;
  emailMasked: string;
  role: InviteRole;
  expiresAt: string;
}
export interface AcceptInviteInput {
  token: string;
  cpf: string;
  password: string;
}
