/**
 * Cria um usuário do portal (dev / primeiro acesso). O cadastro público é desligado,
 * então o primeiro admin ou super_admin nasce por aqui.
 *
 *   pnpm --filter @genus/api rh:create-user -- --email admin@empresa.dev --name "Admin" --role admin --tenant 1
 *   pnpm --filter @genus/api rh:create-user -- --email root@genus.dev --name "Root" --role super_admin
 *
 * Senha: NEW_USER_PASSWORD no ambiente (fora do histórico do shell); sem ela, uma
 * senha aleatória é gerada e mostrada UMA vez no terminal. super_admin precisa
 * ativar o 2FA no primeiro login (POST /auth/two-factor/enable).
 */
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { createLogger } from '@genus/shared';
import { loadEnv } from '../src/config/env';
import { createDatabase } from '../src/db/client';
import { UserService, type CreateUserInput } from '../src/modules/auth/user-service';

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    role: { type: 'string' },
    tenant: { type: 'string' },
    employee: { type: 'string' },
  },
});

const env = loadEnv();
const logger = createLogger({ level: 'warn', service: 'create-user' });
const database = createDatabase(env.databaseUrl, logger, 1);
const generated = process.env.NEW_USER_PASSWORD ? undefined : randomBytes(18).toString('base64url');

try {
  const user = await new UserService({ db: database.db }).createUser({
    email: values.email ?? '',
    name: values.name ?? '',
    role: (values.role ?? '') as CreateUserInput['role'],
    tenantId: values.tenant ? Number(values.tenant) : null,
    employeeId: values.employee ? Number(values.employee) : null,
    password: process.env.NEW_USER_PASSWORD ?? generated ?? '',
  });
  process.stdout.write(`Usuário criado: id=${user.id} email=${user.email} papel=${user.role} conta=${user.tenantId ?? '-'}\n`);
  if (generated) process.stdout.write(`Senha gerada (anote, não aparece de novo): ${generated}\n`);
} catch (err) {
  const e = err as { message?: string; details?: { path: string; message: string }[]; code?: string };
  process.stderr.write(`Falha: ${e.message ?? 'erro'}${e.details ? ` ${JSON.stringify(e.details)}` : ''}${e.code ? ` (${e.code})` : ''}\n`);
  process.exitCode = 1;
} finally {
  await database.close();
}
