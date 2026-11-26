/**
 * Contas (tenants) do painel do super_admin. A guarda `authorize('super_admin')` está no escopo pai
 * (super-admin/routes.ts); aqui não se repete. O `tenantId` vem sempre do parâmetro de rota.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  createTenantBody,
  createdTenantResponse,
  listTenantsQuery,
  suspensionBody,
  tenantIdParams,
  tenantListResponse,
  tenantResponse,
  updateTenantBody,
} from '../contract';
import type { SuperAdminDeps } from '../deps';
import { TenantService } from './service';

const tags = ['Super admin: contas'];

export const tenantRoutes: FastifyPluginAsyncZod<SuperAdminDeps> = async (app, deps) => {
  const service = new TenantService({ db: deps.db, clock: deps.clock, masterKeyHex: deps.masterKeyHex, inviteCpfHashKey: deps.inviteCpfHashKey });

  app.get(
    '/tenants',
    { schema: { tags, summary: 'Lista contas (busca, status e contagens)', querystring: listTenantsQuery, response: { 200: tenantListResponse } } },
    async (req) => service.list(req.query),
  );
  app.post(
    '/tenants',
    {
      schema: {
        tags,
        summary: 'Cria conta, empresa, estabelecimento, chave da empresa e o convite do admin; o token do link sai só nesta resposta',
        body: createTenantBody,
        response: { 201: createdTenantResponse },
      },
    },
    async (req, reply) => {
      reply.header('cache-control', 'no-store');
      return reply.code(201).send({ data: await service.create(req.ctx!, req.body) });
    },
  );
  app.get(
    '/tenants/:tenantId',
    { schema: { tags, params: tenantIdParams, response: { 200: tenantResponse } } },
    async (req) => ({ data: await service.get(req.params.tenantId) }),
  );
  app.patch(
    '/tenants/:tenantId',
    { schema: { tags, summary: 'Renomeia a conta', params: tenantIdParams, body: updateTenantBody, response: { 200: tenantResponse } } },
    async (req) => ({ data: await service.rename(req.ctx!, req.params.tenantId, req.body.name) }),
  );
  app.post(
    '/tenants/:tenantId/suspend',
    { schema: { tags, summary: 'Suspende a conta e derruba as sessões dela', params: tenantIdParams, body: suspensionBody, response: { 200: tenantResponse } } },
    async (req) => ({ data: await service.suspend(req.ctx!, req.params.tenantId, req.body.reason) }),
  );
  app.post(
    '/tenants/:tenantId/reactivate',
    { schema: { tags, summary: 'Reativa a conta suspensa', params: tenantIdParams, body: suspensionBody, response: { 200: tenantResponse } } },
    async (req) => ({ data: await service.reactivate(req.ctx!, req.params.tenantId, req.body.reason) }),
  );
};
