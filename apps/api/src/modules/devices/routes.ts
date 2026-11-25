/**
 * Aparelhos (totem web), sob /portal. Perfis: rh e admin; estabelecimento fora do escopo = 404.
 * docs/totem-contrato.md §3.1.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { idParams } from '../../http/schemas';
import type { PortalDeps } from '../portal/deps';
import {
  calibrationSessionOrNullResponse,
  calibrationSessionResponse,
  calibrationSettingsResponse,
  copyCalibrationBody,
  createDeviceBody,
  deviceActivityResponse,
  deviceListResponse,
  deviceResponse,
  deviceWithKeyResponse,
  listDevicesQuery,
  thresholdsBody,
  updateDeviceBody,
} from './schemas';
import { DeviceService } from './service';

const tags = ['Aparelhos (totem)'];

export const deviceRoutes: FastifyPluginAsyncZod<PortalDeps> = async (app, deps) => {
  const service = new DeviceService(deps);
  const staff = app.authorize('rh', 'admin');

  app.get(
    '/devices',
    { preHandler: [staff], schema: { tags, summary: 'Lista aparelhos (filtro por estabelecimento e conexão)', querystring: listDevicesQuery, response: { 200: deviceListResponse } } },
    async (req) => ({ data: await service.list(req.ctx!, req.query) }),
  );
  app.post(
    '/devices',
    { preHandler: [staff], schema: { tags, summary: 'Cria o aparelho; a chave aparece só nesta resposta', body: createDeviceBody, response: { 201: deviceWithKeyResponse } } },
    async (req, reply) => reply.code(201).send({ data: await service.create(req.ctx!, req.body) }),
  );
  app.get(
    '/devices/:id',
    { preHandler: [staff], schema: { tags, params: idParams, response: { 200: deviceResponse } } },
    async (req) => ({ data: await service.get(req.ctx!, req.params.id) }),
  );
  app.patch(
    '/devices/:id',
    { preHandler: [staff], schema: { tags, params: idParams, body: updateDeviceBody, response: { 200: deviceResponse } } },
    async (req) => ({ data: await service.update(req.ctx!, req.params.id, req.body) }),
  );
  app.delete(
    '/devices/:id',
    { preHandler: [staff], schema: { tags, summary: 'Exclui o aparelho (409 se já registrou batidas)', params: idParams } },
    async (req, reply) => {
      await service.remove(req.ctx!, req.params.id);
      return reply.code(204).send();
    },
  );
  app.post(
    '/devices/:id/regenerate-key',
    { preHandler: [staff], schema: { tags, summary: 'Gera outra chave; a anterior deixa de valer', params: idParams, response: { 200: deviceWithKeyResponse } } },
    async (req) => ({ data: await service.regenerateKey(req.ctx!, req.params.id) }),
  );
  app.get(
    '/devices/:id/activity',
    { preHandler: [staff], schema: { tags, summary: 'Últimos 50 eventos do aparelho', params: idParams, response: { 200: deviceActivityResponse } } },
    async (req) => ({ data: await service.activity(req.ctx!, req.params.id) }),
  );

  app.get(
    '/devices/:id/calibration',
    { preHandler: [staff], schema: { tags, params: idParams, response: { 200: calibrationSettingsResponse } } },
    async (req) => ({ data: await service.getSettings(req.ctx!, req.params.id) }),
  );
  app.get(
    '/devices/:id/calibration/session',
    { preHandler: [staff], schema: { tags, summary: 'Sessão de calibração em aberto (ou a que falhou); null se não há', params: idParams, response: { 200: calibrationSessionOrNullResponse } } },
    async (req) => ({ data: await service.getSession(req.ctx!, req.params.id) }),
  );
  app.post(
    '/devices/:id/calibration/start',
    { preHandler: [staff], schema: { tags, summary: 'Inicia a calibração: o totem entra no assistente ao consultar o contexto', params: idParams, response: { 201: calibrationSessionResponse } } },
    async (req, reply) => reply.code(201).send({ data: await service.startCalibration(req.ctx!, req.params.id) }),
  );
  app.delete(
    '/devices/:id/calibration/session',
    { preHandler: [staff], schema: { tags, summary: 'Descarta a sessão em aberto', params: idParams } },
    async (req, reply) => {
      await service.discardSession(req.ctx!, req.params.id);
      return reply.code(204).send();
    },
  );
  app.put(
    '/devices/:id/calibration/settings',
    { preHandler: [staff], schema: { tags, summary: 'Aplica os limiares (a sessão calculada vira aplicada)', params: idParams, body: thresholdsBody, response: { 200: calibrationSettingsResponse } } },
    async (req) => ({ data: await service.applySettings(req.ctx!, req.params.id, req.body) }),
  );
  app.delete(
    '/devices/:id/calibration/settings',
    { preHandler: [staff], schema: { tags, summary: 'Volta aos limiares padrão da engine', params: idParams, response: { 200: calibrationSettingsResponse } } },
    async (req) => ({ data: await service.resetSettings(req.ctx!, req.params.id) }),
  );
  app.post(
    '/devices/:id/calibration/copy',
    { preHandler: [staff], schema: { tags, summary: 'Copia a calibração de outro aparelho do mesmo estabelecimento', params: idParams, body: copyCalibrationBody, response: { 200: calibrationSettingsResponse } } },
    async (req) => ({ data: await service.copyCalibration(req.ctx!, req.params.id, req.body) }),
  );
};
