/**
 * Leitura e alteração de empresas e estabelecimentos de uma conta. Toda função filtra por `conta_id`.
 * Os INSERTs (empresa, estabelecimento e chave da empresa) são os de `tenants/repository.ts`.
 */
import { and, asc, eq } from 'drizzle-orm';
import type { Executor } from '../../../db/executor';
import { companies, employees, establishments, tenants } from '../../../db/schema';
import type { NewEstablishment } from '../tenants/repository';
import type { CompanyDto, EstablishmentDto } from './schemas';

export type CompanyRow = Omit<CompanyDto, 'establishments'>;

const companyColumns = { id: companies.id, legalName: companies.legalName, cnpj: companies.cnpj, isActive: companies.isActive };
const establishmentColumns = {
  id: establishments.id,
  companyId: establishments.companyId,
  name: establishments.name,
  registrationType: establishments.registrationType,
  registration: establishments.registration,
  uf: establishments.uf,
  municipalityIbge: establishments.municipalityIbge,
  isActive: establishments.isActive,
};

type RawEstablishment = Omit<EstablishmentDto, 'registrationType'> & { registrationType: string };

const toCompany = (r: CompanyRow): CompanyRow => ({ ...r, id: Number(r.id) });
const toEstablishment = (r: RawEstablishment): EstablishmentDto => ({
  ...r,
  id: Number(r.id),
  companyId: Number(r.companyId),
  // O CHECK estab_tipo_inscricao garante o conjunto.
  registrationType: r.registrationType as EstablishmentDto['registrationType'],
});

export class OrganizationRepository {
  async tenantExists(ex: Executor, tenantId: number): Promise<boolean> {
    const [row] = await ex.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    return row !== undefined;
  }

  async companies(ex: Executor, tenantId: number): Promise<CompanyRow[]> {
    const rows = await ex.select(companyColumns).from(companies).where(eq(companies.tenantId, tenantId)).orderBy(asc(companies.id));
    return rows.map(toCompany);
  }

  /** `update` para alterar a empresa; `share` para criar algo que depende de ela continuar ativa. */
  async company(ex: Executor, tenantId: number, companyId: number, lock?: 'update' | 'share'): Promise<CompanyRow | undefined> {
    const query = ex
      .select(companyColumns)
      .from(companies)
      .where(and(eq(companies.tenantId, tenantId), eq(companies.id, companyId)))
      .limit(1);
    const [row] = await (lock ? query.for(lock) : query);
    return row ? toCompany(row) : undefined;
  }

  async establishments(ex: Executor, tenantId: number, companyId?: number): Promise<EstablishmentDto[]> {
    const rows = await ex
      .select(establishmentColumns)
      .from(establishments)
      .where(and(eq(establishments.tenantId, tenantId), companyId === undefined ? undefined : eq(establishments.companyId, companyId)))
      .orderBy(asc(establishments.id));
    return rows.map(toEstablishment);
  }

  /** `FOR UPDATE` segura o cadastro de colaborador (a FK pede KEY SHARE nesta linha) até o fim da transação. */
  async establishment(ex: Executor, tenantId: number, establishmentId: number, lock = false): Promise<EstablishmentDto | undefined> {
    const query = ex
      .select(establishmentColumns)
      .from(establishments)
      .where(and(eq(establishments.tenantId, tenantId), eq(establishments.id, establishmentId)))
      .limit(1);
    const [row] = await (lock ? query.for('update') : query);
    return row ? toEstablishment(row) : undefined;
  }

  async lockEstablishmentsOf(ex: Executor, tenantId: number, companyId: number): Promise<void> {
    await ex
      .select({ id: establishments.id })
      .from(establishments)
      .where(and(eq(establishments.tenantId, tenantId), eq(establishments.companyId, companyId)))
      .orderBy(asc(establishments.id))
      .for('update');
  }

  /** Qualquer colaborador, desligado também: as marcações dele já levam este registro. */
  async companyHasEmployees(ex: Executor, tenantId: number, companyId: number): Promise<boolean> {
    const [row] = await ex
      .select({ id: employees.id })
      .from(employees)
      .innerJoin(establishments, and(eq(establishments.tenantId, employees.tenantId), eq(establishments.id, employees.establishmentId)))
      .where(and(eq(employees.tenantId, tenantId), eq(establishments.companyId, companyId)))
      .limit(1);
    return row !== undefined;
  }

  async establishmentHasEmployees(ex: Executor, tenantId: number, establishmentId: number): Promise<boolean> {
    const [row] = await ex
      .select({ id: employees.id })
      .from(employees)
      .where(and(eq(employees.tenantId, tenantId), eq(employees.establishmentId, establishmentId)))
      .limit(1);
    return row !== undefined;
  }

  async updateCompany(ex: Executor, tenantId: number, companyId: number, patch: Partial<Omit<CompanyRow, 'id'>>): Promise<void> {
    await ex
      .update(companies)
      .set(patch)
      .where(and(eq(companies.tenantId, tenantId), eq(companies.id, companyId)));
  }

  async updateEstablishment(
    ex: Executor,
    tenantId: number,
    establishmentId: number,
    patch: Partial<NewEstablishment & { isActive: boolean }>,
  ): Promise<void> {
    await ex
      .update(establishments)
      .set(patch)
      .where(and(eq(establishments.tenantId, tenantId), eq(establishments.id, establishmentId)));
  }
}
