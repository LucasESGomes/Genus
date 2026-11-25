/**
 * Contrato dos convites (docs/prompts/mvp-superadmin-orquestracao.md). Não há conta no corpo: ela vem
 * da sessão (admin), da rota (super_admin) ou do próprio convite (aceite). Resposta em `strictObject`.
 */
import { z } from 'zod';
import { positiveId } from '../../http/schemas';
import { MIN_PASSWORD_LENGTH } from '../auth/auth';
import { INVITE_ROLES, INVITE_STATUSES } from './rules/invite';

/** Só o teto: dígitos e verificadores são conferidos no service (400 `CPF_INVALIDO`). */
const cpfText = z.string().trim().min(1).max(20);
const token = z.string().min(1).max(200);

export const inviteIdParams = z.object({ inviteId: positiveId });

export const createInviteBody = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.email().max(254),
  role: z.enum(INVITE_ROLES),
  cpf: cpfText,
});

export const previewInviteBody = z.object({ token });
export const acceptInviteBody = z.object({ token, cpf: cpfText, password: z.string().min(MIN_PASSWORD_LENGTH).max(128) });

export const inviteDto = z.strictObject({
  id: z.number(),
  name: z.string(),
  email: z.string(),
  role: z.enum(INVITE_ROLES),
  status: z.enum(INVITE_STATUSES),
  expiresAt: z.string(),
  createdAt: z.string(),
  acceptedAt: z.string().nullable(),
});
export type InviteDto = z.infer<typeof inviteDto>;

export const inviteResponse = z.strictObject({ data: inviteDto });
export const inviteListResponse = z.strictObject({ data: z.array(inviteDto) });
/** `token` aparece SÓ nesta resposta. */
export const createdInviteResponse = z.strictObject({ data: z.strictObject({ invite: inviteDto, token: z.string() }) });

export const invitePreviewResponse = z.strictObject({
  data: z.strictObject({
    tenantName: z.string(),
    name: z.string(),
    emailMasked: z.string(),
    role: z.enum(INVITE_ROLES),
    expiresAt: z.string(),
  }),
});
export const acceptedInviteResponse = z.strictObject({ data: z.strictObject({ email: z.string() }) });
