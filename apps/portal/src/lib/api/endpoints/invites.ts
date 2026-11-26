/**
 * Convites de usuário. `tenantId` null = a própria conta (/portal/invites, papel admin; a conta vem da sessão).
 * Com `tenantId` = painel do super_admin. `preview` e `accept` são públicos: token e CPF vão só no corpo.
 */
import type { ApiClient } from '../client';
import type { EntityId, Envelope } from '../contracts';
import { apiPath } from '../ids';
import type { AcceptInviteInput, CreatedInvite, CreateInviteInput, Invite, InvitePreview } from '../organization-contracts';

const base = (tenantId: EntityId | null) =>
  tenantId === null ? '/portal/invites' : apiPath`/portal/super-admin/tenants/${tenantId}/invites`;

export const invitesApi = (c: ApiClient) => ({
  list: async (tenantId: EntityId | null, signal?: AbortSignal) => (await c.get<Envelope<Invite[]>>(base(tenantId), signal)).data,
  create: async (tenantId: EntityId | null, input: CreateInviteInput) => (await c.post<Envelope<CreatedInvite>>(base(tenantId), input)).data,
  revoke: async (tenantId: EntityId | null, inviteId: EntityId) =>
    (await c.post<Envelope<Invite>>(base(tenantId) + apiPath`/${inviteId}/revoke`)).data,
  preview: async (token: string) => (await c.post<Envelope<InvitePreview>>('/portal/public/invites/preview', { token })).data,
  accept: async (input: AcceptInviteInput) => (await c.post<Envelope<{ email: string }>>('/portal/public/invites/accept', input)).data,
});
export type InvitesApi = ReturnType<typeof invitesApi>;
