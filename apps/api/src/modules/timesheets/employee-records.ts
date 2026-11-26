/**
 * Vários colaboradores no formato que a apuração usa (`EmployeeRecord`). A
 * condição de quem chama precisa filtrar a conta (`colaboradores.conta_id`).
 */
import { and, asc, eq, type SQL } from 'drizzle-orm';
import type { Executor } from '../../db/executor';
import { employees, establishments } from '../../db/schema';
import type { EmployeeRecord } from '../employees/lookup';

export async function listEmployeeRecords(ex: Executor, conditions: SQL[]): Promise<EmployeeRecord[]> {
  return ex
    .select({
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
    })
    .from(employees)
    .innerJoin(establishments, and(eq(establishments.tenantId, employees.tenantId), eq(establishments.id, employees.establishmentId)))
    .where(and(...conditions))
    .orderBy(asc(employees.id));
}

/** O dia está entre a admissão e o desligamento (inclusive)? */
export function isEmployedOn(emp: Pick<EmployeeRecord, 'admissionDate' | 'terminationDate'>, date: string): boolean {
  return emp.admissionDate <= date && (emp.terminationDate === null || date <= emp.terminationDate);
}
