/**
 * Portal do colaborador (G12, RF51 a RF53), sob /portal/me. Só o perfil
 * `colaborador`; o colaborador vem sempre da sessão (`ctx.employeeId`), nunca da
 * requisição. Ajustes, atestados, férias e espelhos ficam nos módulos de cada
 * assunto (rotas /me/... de lá); aqui ficam apuração e banco de horas.
 */
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { timeBankBalances, timeBankEntries } from '../../db/schema';
import { tenantOf } from '../../http/access';
import { HttpError } from '../../plugins/error-handler';
import type { RequestContext } from '../../plugins/request-context';
import type { PortalDeps } from '../portal/deps';
import { periodQuery, timesheetListResponse } from '../timesheets/schemas';
import { TimesheetService } from '../timesheets/service';

const tags = ['Portal do colaborador'];

const timeBankResponse = z.object({
  data: z.object({
    balanceMinutes: z.number(),
    expiringIn30DaysMinutes: z.number(),
    entries: z.array(z.object({ date: z.string(), type: z.string(), minutes: z.number(), dueDate: z.string().nullable() })),
  }),
});

function selfId(ctx: RequestContext): number {
  if (ctx.employeeId === null) throw new HttpError(403, 'FORBIDDEN', 'Você não tem permissão para esta ação');
  return ctx.employeeId;
}

export const employeePortalRoutes: FastifyPluginAsyncZod<PortalDeps> = async (app, deps) => {
  const timesheets = new TimesheetService(deps);
  const self = app.authorize('colaborador');

  app.get(
    '/me/timesheets',
    { preHandler: [self], schema: { tags, summary: 'Minha apuração (RF51)', querystring: periodQuery, response: { 200: timesheetListResponse } } },
    async (req) => ({ data: await timesheets.list(req.ctx!, selfId(req.ctx!), req.query.from, req.query.to) }),
  );

  app.get(
    '/me/time-bank',
    { preHandler: [self], schema: { tags, summary: 'Meu saldo e extrato do banco de horas (RF52)', response: { 200: timeBankResponse } } },
    async (req) => {
      const ctx = req.ctx!;
      const employeeId = selfId(ctx);
      const tenantId = tenantOf(ctx);
      const [[balance], entries] = await Promise.all([
        deps.db.select().from(timeBankBalances).where(and(eq(timeBankBalances.tenantId, tenantId), eq(timeBankBalances.employeeId, employeeId))),
        deps.db
          .select({ date: timeBankEntries.referenceDate, type: timeBankEntries.type, minutes: timeBankEntries.minutes, dueDate: timeBankEntries.dueDate })
          .from(timeBankEntries)
          .where(and(eq(timeBankEntries.tenantId, tenantId), eq(timeBankEntries.employeeId, employeeId)))
          .orderBy(asc(timeBankEntries.referenceDate), asc(timeBankEntries.id)),
      ]);
      return { data: { balanceMinutes: balance?.balanceMinutes ?? 0, expiringIn30DaysMinutes: balance?.expiringIn30DaysMinutes ?? 0, entries } };
    },
  );
};
