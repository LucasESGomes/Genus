/**
 * Setores, cargos e centros de custo (G1, RF02), sob /portal.
 * Leitura: rh, admin, gestor (se ligado) e contador. Escrita: rh e admin.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { idParams } from '../../http/schemas';
import type { PortalDeps } from '../portal/deps';
import {
  costCenterListResponse,
  costCenterResponse,
  createCostCenterBody,
  createDepartmentBody,
  createJobTitleBody,
  departmentListResponse,
  departmentResponse,
  jobTitleListResponse,
  jobTitleResponse,
  orgUnitListQuery,
  updateCostCenterBody,
  updateDepartmentBody,
  updateJobTitleBody,
} from './schemas';
import { OrgUnitService } from './service';

const tags = ['Cadastros'];

export const orgUnitRoutes: FastifyPluginAsyncZod<PortalDeps> = async (app, deps) => {
  const service = new OrgUnitService(deps);
  const readers = app.authorize(...deps.access.roles('rh', 'admin', 'gestor', 'contador'));
  const writers = app.authorize('rh', 'admin');

  app.get(
    '/departments',
    { preHandler: [readers], schema: { tags, summary: 'Setores do estabelecimento', querystring: orgUnitListQuery, response: { 200: departmentListResponse } } },
    async (req) => ({ data: await service.listDepartments(req.ctx!, req.query.establishmentId) }),
  );
  app.post(
    '/departments',
    { preHandler: [writers], schema: { tags, body: createDepartmentBody, response: { 201: departmentResponse } } },
    async (req, reply) => reply.code(201).send({ data: await service.createDepartment(req.ctx!, req.body) }),
  );
  app.patch(
    '/departments/:id',
    { preHandler: [writers], schema: { tags, params: idParams, body: updateDepartmentBody, response: { 200: departmentResponse } } },
    async (req) => ({ data: await service.updateDepartment(req.ctx!, req.params.id, req.body) }),
  );

  app.get(
    '/job-titles',
    { preHandler: [readers], schema: { tags, summary: 'Cargos da empresa do estabelecimento', querystring: orgUnitListQuery, response: { 200: jobTitleListResponse } } },
    async (req) => ({ data: await service.listJobTitles(req.ctx!, req.query.establishmentId) }),
  );
  app.post(
    '/job-titles',
    { preHandler: [writers], schema: { tags, body: createJobTitleBody, response: { 201: jobTitleResponse } } },
    async (req, reply) => reply.code(201).send({ data: await service.createJobTitle(req.ctx!, req.body) }),
  );
  app.patch(
    '/job-titles/:id',
    { preHandler: [writers], schema: { tags, params: idParams, body: updateJobTitleBody, response: { 200: jobTitleResponse } } },
    async (req) => ({ data: await service.updateJobTitle(req.ctx!, req.params.id, req.body) }),
  );

  app.get(
    '/cost-centers',
    { preHandler: [readers], schema: { tags, summary: 'Centros de custo da empresa do estabelecimento', querystring: orgUnitListQuery, response: { 200: costCenterListResponse } } },
    async (req) => ({ data: await service.listCostCenters(req.ctx!, req.query.establishmentId) }),
  );
  app.post(
    '/cost-centers',
    { preHandler: [writers], schema: { tags, body: createCostCenterBody, response: { 201: costCenterResponse } } },
    async (req, reply) => reply.code(201).send({ data: await service.createCostCenter(req.ctx!, req.body) }),
  );
  app.patch(
    '/cost-centers/:id',
    { preHandler: [writers], schema: { tags, params: idParams, body: updateCostCenterBody, response: { 200: costCenterResponse } } },
    async (req) => ({ data: await service.updateCostCenter(req.ctx!, req.params.id, req.body) }),
  );
};
