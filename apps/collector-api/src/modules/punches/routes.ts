import { punchResponseSchema, roundMs, startTimer, type PunchTimings } from '@genus/shared';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { HttpError } from '../../plugins/error-handler';
import { parsePunchRequest } from './schemas';
import type { PunchService } from './service';

export interface PunchRoutesOptions {
  service: PunchService;
  exposeTimings: boolean;
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
  scope.withTypeProvider<ZodTypeProvider>().post(
    '/batidas',
    {
      schema: {
        tags: ['Batidas'],
        summary: 'Registrar batida por reconhecimento facial',
        description: [
          'Fluxo: chave de serviço → validação → idempotência por (aparelho, `deviceSequence`) → candidatos do servidor → engine → INSERT em `arp.entradas` (`pendente`).',
          '',
          '- `registered`: rosto identificado; `receiptId` é o recibo (o mesmo em todo reenvio da mesma sequência).',
          '- `fallback_required` (**HTTP 200**, nada gravado): o aparelho segue pelo PIN. `reason` diz por quê.',
          '',
          'O aparelho, o estabelecimento, a conta e a lista de candidatos vêm do servidor, nunca do corpo.',
        ].join('\n'),
        security: [{ serviceKey: [] }],
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
};
