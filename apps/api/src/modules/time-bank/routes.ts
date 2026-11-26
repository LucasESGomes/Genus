/**
 * Banco de horas (G8), sob /portal. Saldos e extrato: rh, admin e gestor
 * (equipe, se ligado). Regra do estabelecimento: consulta rh e admin, escrita
 * só rh. O colaborador consulta o próprio em /portal/me/time-bank.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { idParams } from '../../http/schemas';
import { HttpError } from '../../plugins/error-handler';
import type { PortalDeps } from '../portal/deps';
import {
  balanceListResponse,
  balancesQuery,
  currentPolicyResponse,
  policyBody,
  policyResponse,
  timeBankResponse,
} from './schemas';
import { TimeBankService } from './service';

const tags = ['Banco de horas'];

export const timeBankRoutes: FastifyPluginAsyncZod<PortalDeps> = async (app, deps) => {
  const service = new TimeBankService(deps);
  const readers = app.authorize(...deps.access.roles('rh', 'admin', 'gestor'));

  app.get(
    '/time-bank',
    { preHandler: [readers], schema: { tags, summary: 'Saldos do banco de horas por colaborador', querystring: balancesQuery, response: { 200: balanceListResponse } } },
    async (req) => service.balances(req.ctx!, req.query),
  );

  app.get(
    '/employees/:id/time-bank',
    { preHandler: [readers], schema: { tags, summary: 'Saldo e extrato do colaborador', params: idParams, response: { 200: timeBankResponse } } },
    async (req) => ({ data: await service.forEmployee(req.ctx!, req.params.id) }),
  );

  app.get(
    '/establishments/:id/time-bank-policy',
    {
      preHandler: [app.authorize('rh', 'admin')],
      schema: { tags, summary: 'Regra do banco de horas do estabelecimento (vigente ou próxima)', params: idParams, response: { 200: currentPolicyResponse } },
    },
    async (req) => ({ data: await service.policy(req.ctx!, req.params.id) }),
  );

  app.put(
    '/establishments/:id/time-bank-policy',
    {
      preHandler: [app.authorize('rh')],
      schema: {
        tags,
        summary: 'Define a regra do banco de horas a partir de uma data',
        params: idParams,
        body: policyBody,
        response: { 200: policyResponse },
      },
    },
    async (req) => {
      const saved = await service.savePolicy(req.ctx!, req.params.id, req.body);
      if (saved === 'vigencia_anterior') {
        throw new HttpError(409, 'BANCO_REGRA_VIGENCIA', 'A vigência não pode começar antes da regra atual');
      }
      return { data: saved };
    },
  );
};
