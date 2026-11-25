import {
  punchListQuerySchema,
  punchListResponseSchema,
  punchResponseSchema,
  punchStatusResponseSchema,
  roundMs,
  startTimer,
  type PunchTimings,
} from '@genus/shared';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { HttpError } from '../../plugins/error-handler';
import { parsePunchRequest } from './schemas';
import type { PunchService } from './service';
import type { PunchStatusService } from './status-service';

export interface PunchRoutesOptions {
  service: PunchService;
  statusService: PunchStatusService;
  exposeTimings: boolean;
  /**
   * `service` (padrão): `/coletor/*`, chave de serviço, todas as rotas.
   * `totem`: `/coletor/totem/*`, chave do aparelho; só enviar a batida e acompanhar o job
   * (a listagem por colaborador não existe aqui e o job é só do próprio aparelho).
   */
  mode?: 'service' | 'totem';
}

/** `validate;dur=1.2, candidates;dur=0.3, ...`; omite etapas que não ocorreram. */
export function formatServerTiming(t: Partial<PunchTimings> & { validate: number; total: number }): string {
  const entries: [string, number | null | undefined][] = [
    ['validate', t.validate],
    ['candidates', t.candidates],
    ['engine', t.engineRoundTrip],
    ['engine-processing', t.engineProcessing],
    ['db', t.dbInsert],
    ['total', t.total],
  ];
  return entries
    .filter((e): e is [string, number] => typeof e[1] === 'number')
    .map(([name, dur]) => `${name};dur=${dur}`)
    .join(', ');
}

export const punchRoutes: FastifyPluginAsync<PunchRoutesOptions> = async (scope, opts) => {
  const isTotem = opts.mode === 'totem';
  const security = isTotem ? [{ deviceKey: [] }] : [{ serviceKey: [] }];
  scope.withTypeProvider<ZodTypeProvider>().post(
    '/batidas',
    {
      schema: {
        tags: ['Batidas'],
        summary: 'Registrar batida por reconhecimento facial',
        description: [
          'Fluxo: ' + (isTotem ? 'chave do aparelho (X-Device-Key)' : 'chave de serviço') + ' → validação → idempotência por (aparelho, `deviceSequence`) → candidatos do servidor → engine → INSERT em `arp.entradas` (`pendente`).',
          '',
          '- `registered`: rosto identificado; `receiptId` é o recibo (o mesmo em todo reenvio da mesma sequência).',
          '- `fallback_required` (**HTTP 200**, nada gravado): o aparelho segue pelo PIN. `reason` diz por quê.',
          '',
          'O aparelho, o estabelecimento, a conta e a lista de candidatos vêm do servidor, nunca do corpo.',
        ].join('\n'),
        security,
        response: { 200: punchResponseSchema },
      },
    },
    async (req, reply) => {
      const total = startTimer();
      const validateTimer = startTimer();
      const ctx = req.deviceContext;
      if (!ctx) throw new HttpError(401, 'UNAUTHORIZED', 'Não autorizado');

      let parsed;
      try {
        parsed = await parsePunchRequest(req);
      } catch (err) {
        const validate = roundMs(validateTimer());
        reply.header('Server-Timing', formatServerTiming({ validate, total: roundMs(total()) }));
        throw err;
      }
      const validateMs = validateTimer();

      let output;
      try {
        output = await opts.service.register(ctx, {
          image: parsed.image,
          imageMime: parsed.imageMime,
          deviceSequence: parsed.fields.deviceSequence,
          capturedAt: new Date(parsed.fields.capturedAt),
          validateMs,
          totalTimer: total,
        });
      } catch (err) {
        reply.header('Server-Timing', formatServerTiming({ validate: roundMs(validateMs), total: roundMs(total()) }));
        throw err;
      }

      reply.header('Server-Timing', formatServerTiming(output.timings));
      return opts.exposeTimings
        ? { data: output.result, meta: { timings: output.timings } }
        : { data: output.result };
    },
  );

  scope.withTypeProvider<ZodTypeProvider>().get(
    '/batidas/jobs/:jobId',
    {
      schema: {
        tags: ['Batidas'],
        summary: 'Status de uma batida pelo id do job',
        description: [
          '`jobId` é o devolvido no POST (`<aparelhoId>-<sequencia>`). Só batidas da conta do aparelho.',
          '',
          '- `status` (banco, fonte da verdade): `pendente` até o rep-core atribuir o NSR; então `processado`, com `nsr` e `processedAt`.',
          '- `queue` (diagnóstico): estado do job no BullMQ. `not_found` = fora do Valkey (concluídos saem em 24 h, ou ainda não publicado); `unavailable` = Valkey sem resposta.',
          '',
          '404 se o `jobId` for inválido ou não houver batida dele nesta conta.',
        ].join('\n'),
        security,
        params: z.object({ jobId: z.string().max(64) }),
        response: { 200: punchStatusResponseSchema },
      },
    },
    async (req) => {
      const ctx = req.deviceContext;
      if (!ctx) throw new HttpError(401, 'UNAUTHORIZED', 'Não autorizado');
      const status = await opts.statusService.getByJobId(ctx, req.params.jobId, { onlyOwnDevice: isTotem });
      if (!status) throw new HttpError(404, 'NOT_FOUND', 'Batida não encontrada');
      return { data: status };
    },
  );

  if (isTotem) return;

  scope.withTypeProvider<ZodTypeProvider>().get(
    '/batidas',
    {
      schema: {
        tags: ['Batidas'],
        summary: 'Batidas de um colaborador',
        description:
          'Lista as batidas de `employeeId` na conta do aparelho, da mais recente para a mais antiga, com o status de cada uma. Paginada (`page`, `pageSize` até 100). Sem o estado da fila: para isso, consulte por `jobId`.',
        security,
        querystring: punchListQuerySchema,
        response: { 200: punchListResponseSchema },
      },
    },
    async (req) => {
      const ctx = req.deviceContext;
      if (!ctx) throw new HttpError(401, 'UNAUTHORIZED', 'Não autorizado');
      const { items, total } = await opts.statusService.listByEmployee(ctx, req.query);
      return { data: items, meta: { page: req.query.page, pageSize: req.query.pageSize, total } };
    },
  );
};
