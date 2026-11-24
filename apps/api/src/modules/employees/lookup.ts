/**
 * Busca de colaborador já com a checagem de escopo (conta, estabelecimento,
 * equipe, próprio). Todos os módulos do portal passam por aqui antes de ler
 * ou gravar algo de um colaborador.
 */
import { and, eq } from 'drizzle-orm';
import type { Executor } from '../../db/executor';
import { establishments, employees } from '../../db/schema';
import { employeeVisibleTo, notFound, tenantOf, type ScopedEmployee } from '../../http/access';
import type { RequestContext } from '../../plugins/request-context';

export interface EmployeeRecord extends ScopedEmployee {
  cpf: string;
  name: string;
  companyId: number;
  uf: string;
  municipalityIbge: string;
  admissionDate: string;
  terminationDate: string | null;
}

const columns = {
  id: employees.id,
  tenantId: employees.tenantId,
  establishmentId: employees.establishmentId,
  managerId: employees.managerId,
  cpf: employees.cpf,
  name: employees.name,
  companyId: establishments.companyId,
  uf: establishments.uf,
  municipalityIbge: establishments.municipalityIbge,
  admissionDate: employees.admissionDate,
  terminationDate: employees.terminationDate,
};

/** 404 se não existir OU estiver fora do escopo de quem pede. */
export async function findEmployeeInScope(ex: Executor, ctx: RequestContext, employeeId: number): Promise<EmployeeRecord> {
  const tenantId = tenantOf(ctx);
  const [row] = await ex
    .select(columns)
    .from(employees)
    .innerJoin(establishments, and(eq(establishments.tenantId, employees.tenantId), eq(establishments.id, employees.establishmentId)))
    .where(and(eq(employees.tenantId, tenantId), eq(employees.id, employeeId)))
    .limit(1);
  if (!row || !employeeVisibleTo(ctx, row)) throw notFound('Colaborador');
  return row;
}

/** Por CPF, dentro da conta (o CPF é único por conta). Sem checar escopo: quem chama checa. */
export async function findEmployeeByCpf(ex: Executor, tenantId: number, cpf: string): Promise<(EmployeeRecord & { pinHash: string }) | null> {
  const [row] = await ex
    .select({ ...columns, pinHash: employees.pinHash })
    .from(employees)
    .innerJoin(establishments, and(eq(establishments.tenantId, employees.tenantId), eq(establishments.id, employees.establishmentId)))
    .where(and(eq(employees.tenantId, tenantId), eq(employees.cpf, cpf)))
    .limit(1);
  return row ?? null;
}
