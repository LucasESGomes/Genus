/**
 * Feriados (G3, RF14 a RF16), sob /portal. Leitura: rh, admin e gestor (se ligado).
 * Escrita: rh (feriado da conta e regra do estabelecimento) e admin (regra de feriado trabalhado, 04 §7.1).
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { idParams } from '../../http/schemas';
import type { PortalDeps } from '../portal/deps';
import {
  createHolidayBody,
  establishmentHolidayParams,
  holidayListResponse,
  holidayResponse,
  listHolidaysQuery,
  setEstablishmentHolidayBody,
  updateHolidayBody,
} from './schemas';
import { HolidayService } from './service';

const tags = ['Feriados'];

export const holidayRoutes: FastifyPluginAsyncZod<PortalDeps> = async (app, deps) => {
  const service = new HolidayService(deps);
  const readers = app.authorize(...deps.access.roles('rh', 'admin', 'gestor'));
  const writers = app.authorize('rh', 'admin');

  app.get(
    '/holidays',
    { preHandler: [readers], schema: { tags, summary: 'Feriados que valem no estabelecimento no ano', querystring: listHolidaysQuery, response: { 200: holidayListResponse } } },
    async (req) => ({ data: await service.list(req.ctx!, req.query.establishmentId, req.query.year) }),
  );
  app.post(
    '/holidays',
    { preHandler: [writers], schema: { tags, summary: 'Feriado da conta (nacional = todos os estabelecimentos da conta)', body: createHolidayBody, response: { 201: holidayResponse } } },
    async (req, reply) => reply.code(201).send({ data: await service.create(req.ctx!, req.body) }),
  );
  app.patch(
    '/holidays/:id',
    { preHandler: [writers], schema: { tags, summary: 'Altera feriado da conta (os oficiais não mudam)', params: idParams, body: updateHolidayBody, response: { 200: holidayResponse } } },
    async (req) => ({ data: await service.update(req.ctx!, req.params.id, req.body) }),
  );
  app.delete(
    '/holidays/:id',
    { preHandler: [writers], schema: { tags, summary: 'Remove feriado da conta', params: idParams } },
    async (req, reply) => {
      await service.remove(req.ctx!, req.params.id);
      return reply.code(204).send();
    },
  );
  app.put(
    '/establishments/:id/holidays/:holidayId',
    {
      preHandler: [writers],
      schema: { tags, summary: 'O estabelecimento trabalha no feriado? Como trata a hora (RF16)', params: establishmentHolidayParams, body: setEstablishmentHolidayBody, response: { 200: holidayResponse } },
    },
    async (req) => ({ data: await service.setForEstablishment(req.ctx!, req.params.id, req.params.holidayId, req.body) }),
  );
};
