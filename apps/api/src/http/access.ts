/**
 * Controle de acesso do portal de RH, checado no servidor em toda rota:
 *   - papel: cada rota declara os perfis (`app.authorize`, via `PortalAccess.roles`);
 *   - escopo: conta da sessão + estabelecimentos do usuário (`usuarios_estabelecimentos`,
 *     RNF02) + equipe, para o gestor (`colaboradores.gestor_id`) + o próprio, para o colaborador.
 *
 * Colaborador fora do escopo responde 404, não 403: a resposta não confirma que ele existe.
 */
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { employees } from '../db/schema';
import { HttpError } from '../plugins/error-handler';
import type { RequestContext, Role } from '../plugins/request-context';

export const notFound = (what = 'Recurso') => new HttpError(404, 'NOT_FOUND', `${what} não encontrado`);

/** Conta da sessão. O super_admin (sem conta) não lê dado de colaborador (security-lgpd §5). */
export function tenantOf(ctx: RequestContext): number {
  if (ctx.tenantId === null) throw new HttpError(403, 'FORBIDDEN', 'Você não tem permissão para esta ação');
  return ctx.tenantId;
}

export class PortalAccess {
  /** Gestor é opcional e começa desligado (04 §1.4, §9 item 20). Desligado: 403 em tudo. */
  constructor(readonly gestorEnabled: boolean) {}

  /** Perfis da rota, tirando o gestor quando o módulo de gestor está desligado. */
  roles(...roles: Role[]): Role[] {
    return this.gestorEnabled ? roles : roles.filter((r) => r !== 'gestor');
  }
}

export interface ScopedEmployee {
  id: number;
  tenantId: number;
  establishmentId: number;
  managerId: number | null;
}

export function employeeVisibleTo(ctx: RequestContext, e: ScopedEmployee): boolean {
  if (ctx.tenantId === null || e.tenantId !== ctx.tenantId) return false;
  if (ctx.establishmentScope !== null && !ctx.establishmentScope.includes(e.establishmentId)) return false;
  if (ctx.role === 'colaborador') return ctx.employeeId === e.id;
  if (ctx.role === 'gestor') return ctx.employeeId !== null && e.managerId === ctx.employeeId;
  return true;
}

/** Condições SQL equivalentes a `employeeVisibleTo`, para listas. */
export function employeeScopeConditions(ctx: RequestContext): SQL[] {
  const conds: SQL[] = [eq(employees.tenantId, tenantOf(ctx))];
  if (ctx.establishmentScope !== null) conds.push(inArray(employees.establishmentId, ctx.establishmentScope));
  if (ctx.role === 'colaborador') conds.push(ctx.employeeId === null ? sql`false` : eq(employees.id, ctx.employeeId));
  if (ctx.role === 'gestor') conds.push(ctx.employeeId === null ? sql`false` : eq(employees.managerId, ctx.employeeId));
  return conds;
}

/** O estabelecimento está no escopo do usuário? (para criar coisas ligadas a ele) */
export function establishmentInScope(ctx: RequestContext, establishmentId: number): boolean {
  return ctx.establishmentScope === null || ctx.establishmentScope.includes(establishmentId);
}

export const allConditions = (conds: SQL[]) => and(...conds);

/** Perfis que veem salário (04 §1.4: RH e admin [A CONFIRMAR]; security-lgpd.md §1 ainda diz "só RH"). */
export const SALARY_ROLES: readonly Role[] = ['rh', 'admin'];
/** Perfis que veem o CPF completo. Os demais recebem o CPF mascarado. */
export const FULL_CPF_ROLES: readonly Role[] = ['rh', 'admin'];
