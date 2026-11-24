/**
 * `GET /me`: o próprio usuário autenticado (cookie ou JWT). Nunca devolve hash,
 * token nem segredo: o DTO abaixo lista o que sai.
 */
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Database } from '../../db/client';
import { users } from '../../db/schema';
import { ROLES } from '../../plugins/request-context';

export const meResponseSchema = z.object({
  data: z.object({
    id: z.number(),
    tenantId: z.number().nullable(),
    employeeId: z.number().nullable(),
    name: z.string(),
    email: z.string(),
    role: z.enum(ROLES),
    mfaEnabled: z.boolean(),
    establishmentScope: z.array(z.number()).nullable(),
    authenticatedVia: z.enum(['cookie', 'jwt']),
  }),
});

export const meRoutes: FastifyPluginAsyncZod<{ db: Database }> = async (app, opts) => {
  app.get(
    '/me',
    { preHandler: [app.authenticate], schema: { tags: ['auth'], response: { 200: meResponseSchema } } },
    async (req) => {
      const ctx = req.ctx!;
      const [u] = await opts.db
        .select({ name: users.name, email: users.email, mfaEnabled: users.mfaEnabled })
        .from(users)
        .where(eq(users.id, ctx.userId))
        .limit(1);
      return {
        data: {
          id: ctx.userId,
          tenantId: ctx.tenantId,
          employeeId: ctx.employeeId,
          name: u!.name,
          email: u!.email,
          role: ctx.role,
          mfaEnabled: u!.mfaEnabled,
          establishmentScope: ctx.establishmentScope,
          authenticatedVia: ctx.via,
        },
      };
    },
  );
};
