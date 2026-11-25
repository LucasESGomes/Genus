/**
 * Empresas e estabelecimentos de uma conta (docs/prompts/mvp-superadmin-orquestracao.md). A guarda
 * `authorize('super_admin')` está no escopo pai; o `tenantId` vem sempre do parâmetro de rota.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { tenantIdParams } from '../contract';
import type { SuperAdminDeps } from '../deps';
import {
  companyListResponse,
  companyParams,
  companyResponse,
  createCompanyBody,
  createEstablishmentBody,
  establishmentParams,
  establishmentResponse,
  updateCompanyBody,
  updateEstablishmentBody,
} from './schemas';
import { OrganizationService } from './service';

const tags = ['Super admin: empresas e estabelecimentos'];

export const organizationRoutes: FastifyPluginAsyncZod<SuperAdminDeps> = async (app, deps) => {
  const service = new OrganizationService({ db: deps.db, clock: deps.clock, masterKeyHex: deps.masterKeyHex });

  app.get(
    '/tenants/:tenantId/companies',
    { schema: { tags, summary: 'Empresas da conta, com os estabelecimentos', params: tenantIdParams, response: { 200: companyListResponse } } },
    async (req) => ({ data: await service.listCompanies(req.params.tenantId) }),
  );
  app.post(
    '/tenants/:tenantId/companies',
    { schema: { tags, summary: 'Cria a empresa e a chave dela', params: tenantIdParams, body: createCompanyBody, response: { 201: companyResponse } } },
    async (req, reply) => reply.code(201).send({ data: await service.createCompany(req.ctx!, req.params.tenantId, req.body) }),
  );
  app.patch(
    '/tenants/:tenantId/companies/:companyId',
    { schema: { tags, summary: 'Altera, desativa ou reativa a empresa', params: companyParams, body: updateCompanyBody, response: { 200: companyResponse } } },
    async (req) => ({ data: await service.updateCompany(req.ctx!, req.params.tenantId, req.params.companyId, req.body) }),
  );
  app.post(
    '/tenants/:tenantId/companies/:companyId/establishments',
    { schema: { tags, summary: 'Cria um estabelecimento na empresa', params: companyParams, body: createEstablishmentBody, response: { 201: establishmentResponse } } },
    async (req, reply) =>
      reply.code(201).send({ data: await service.createEstablishment(req.ctx!, req.params.tenantId, req.params.companyId, req.body) }),
  );
  app.patch(
    '/tenants/:tenantId/establishments/:establishmentId',
    { schema: { tags, summary: 'Altera, desativa ou reativa o estabelecimento', params: establishmentParams, body: updateEstablishmentBody, response: { 200: establishmentResponse } } },
    async (req) => ({ data: await service.updateEstablishment(req.ctx!, req.params.tenantId, req.params.establishmentId, req.body) }),
  );
};
