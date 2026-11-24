/**
 * Criação de usuário do portal. O cadastro público do Better Auth está desligado:
 * todo usuário nasce aqui (RH/admin, ou o script de dev `pnpm rh:create-user`).
 *
 * Usuário e credencial (hash scrypt do Better Auth em `credenciais_login`) são
 * gravados numa transação. A senha nunca é logada nem devolvida.
 */
import { hashPassword } from 'better-auth/crypto';
import { z } from 'zod';
import type { Database } from '../../db/client';
import { loginCredentials, users } from '../../db/schema';
import { HttpError } from '../../plugins/error-handler';
import { ROLES } from '../../plugins/request-context';
import { MIN_PASSWORD_LENGTH } from './auth';

export const createUserInput = z
  .object({
    /** Conta do usuário. Em rota, vem do ctx de quem cria, nunca do corpo. NULL só para super_admin. */
    tenantId: z.number().int().positive().nullable(),
    email: z.email().max(254),
    name: z.string().trim().min(1).max(200),
    role: z.enum(ROLES),
    employeeId: z.number().int().positive().nullable().default(null),
    password: z.string().min(MIN_PASSWORD_LENGTH).max(128),
  })
  .refine((u) => (u.role === 'super_admin') === (u.tenantId === null), {
    message: 'Só o super_admin fica sem conta',
    path: ['tenantId'],
  })
  .refine((u) => u.role !== 'colaborador' || u.employeeId !== null, {
    message: 'Usuário colaborador precisa estar ligado a um colaborador',
    path: ['employeeId'],
  });
export type CreateUserInput = z.input<typeof createUserInput>;

export interface CreatedUser {
  id: number;
  tenantId: number | null;
  email: string;
  name: string;
  role: (typeof ROLES)[number];
}

export class UserService {
  constructor(private readonly d: { db: Database }) {}

  async createUser(input: CreateUserInput): Promise<CreatedUser> {
    const parsed = createUserInput.safeParse(input);
    if (!parsed.success) {
      throw new HttpError(
        400,
        'VALIDATION_ERROR',
        'Dados do usuário inválidos',
        // Só o caminho e a mensagem; nunca o valor (pode ser a senha).
        parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }
    const u = parsed.data;
    const passwordHash = await hashPassword(u.password);

    return this.d.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(users)
        .values({ tenantId: u.tenantId, email: u.email, name: u.name, role: u.role, employeeId: u.employeeId })
        .returning({ id: users.id, tenantId: users.tenantId, email: users.email, name: users.name });
      if (!row) throw new Error('INSERT em usuarios não devolveu linha');
      const id = Number(row.id);
      await tx.insert(loginCredentials).values({ userId: id, accountId: String(id), providerId: 'credential', password: passwordHash });
      return { id, tenantId: row.tenantId === null ? null : Number(row.tenantId), email: row.email, name: row.name, role: u.role };
    });
  }
}
