/**
 * Portal do colaborador (G12, RF51 a RF53), sob /portal/me. Só o perfil
 * `colaborador`; o colaborador vem sempre da sessão (`ctx.employeeId`), nunca da
 * requisição. Ajustes, atestados, férias e espelhos ficam nos módulos de cada
 * assunto (rotas /me/... de lá); aqui ficam apuração e banco de horas.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { HttpError } from '../../plugins/error-handler';
import type { RequestContext } from '../../plugins/request-context';
import type { PortalDeps } from '../portal/deps';
import { timeBankResponse } from '../time-bank/schemas';
import { TimeBankService } from '../time-bank/service';
import { periodQuery, timesheetListResponse } from '../timesheets/schemas';
import { TimesheetService } from '../timesheets/service';

const tags = ['Portal do colaborador'];

function selfId(ctx: RequestContext): number {
  if (ctx.employeeId === null) throw new HttpError(403, 'FORBIDDEN', 'Você não tem permissão para esta ação');
  return ctx.employeeId;
}

export const employeePortalRoutes: FastifyPluginAsyncZod<PortalDeps> = async (app, deps) => {
  const timesheets = new TimesheetService(deps);
  const timeBank = new TimeBankService(deps);
  const self = app.authorize('colaborador');

  app.get(
    '/me/timesheets',
    { preHandler: [self], schema: { tags, summary: 'Minha apuração (RF51)', querystring: periodQuery, response: { 200: timesheetListResponse } } },
    async (req) => ({ data: await timesheets.list(req.ctx!, selfId(req.ctx!), req.query.from, req.query.to) }),
  );

  app.get(
    '/me/time-bank',
    { preHandler: [self], schema: { tags, summary: 'Meu saldo e extrato do banco de horas (RF52)', response: { 200: timeBankResponse } } },
    async (req) => ({ data: await timeBank.forEmployee(req.ctx!, selfId(req.ctx!)) }),
  );
};
