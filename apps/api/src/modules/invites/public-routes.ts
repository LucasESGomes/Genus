/**
 * Rotas SEM sessão do aceite do convite. O token vai no corpo (nunca na URL) e a resposta não é
 * guardada em cache. Limite de falhas por IP em memória do processo (429 `MUITAS_TENTATIVAS`); o limite
 * de CPF errado por convite é do banco e vale em qualquer instância.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { AttemptLimiter } from '../../http/attempt-limiter';
import { HttpError } from '../../plugins/error-handler';
import type { PortalDeps } from '../portal/deps';
import { acceptedInviteResponse, acceptInviteBody, invitePreviewResponse, previewInviteBody } from './schemas';
import type { InviteService } from './service';

export const MAX_PUBLIC_FAILURES_PER_IP = 10;

const tags = ['Convites'];
const COUNTED: readonly string[] = ['CONVITE_INVALIDO', 'CPF_NAO_CONFERE'];

export const publicInviteRoutes: FastifyPluginAsyncZod<PortalDeps & { service: InviteService }> = async (app, { service, clock }) => {
  const limiter = new AttemptLimiter(clock, MAX_PUBLIC_FAILURES_PER_IP);

  async function limited<T>(ip: string, run: () => Promise<T>): Promise<T> {
    limiter.assertAllowed(ip);
    try {
      return await run();
    } catch (err) {
      if (err instanceof HttpError && COUNTED.includes(err.code)) limiter.fail(ip);
      throw err;
    }
  }

  app.post(
    '/public/invites/preview',
    { schema: { tags, summary: 'Dados do convite (público, e-mail mascarado)', body: previewInviteBody, response: { 200: invitePreviewResponse } } },
    async (req, reply) => {
      reply.header('cache-control', 'no-store');
      return { data: await limited(req.ip, () => service.preview(req.body.token)) };
    },
  );

  app.post(
    '/public/invites/accept',
    { schema: { tags, summary: 'Aceita o convite: confere o CPF e cria o usuário com a senha (público)', body: acceptInviteBody, response: { 201: acceptedInviteResponse } } },
    async (req, reply) => {
      reply.header('cache-control', 'no-store');
      const data = await limited(req.ip, () => service.accept(req.body));
      return reply.code(201).send({ data });
    },
  );
};
