/**
 * Empresas e estabelecimentos de uma conta, pelo super_admin. Toda escrita é uma transação auditada.
 *
 * Empresa nova nasce com a chave (DEK) em `chaves_empresa`: sem ela o cadastro facial falha. Não há
 * exclusão, só `isActive: false`, que não toca em marcações. O registro (CNPJ da empresa; tipo e número da
 * inscrição do estabelecimento) não muda depois que existe colaborador ligado a ele.
 */
import { encryptDek, generateDek, type Clock } from '@genus/shared';
import type { Database } from '../../../db/client';
import type { Executor, Transaction } from '../../../db/executor';
import { notFound } from '../../../http/access';
import { HttpError, pgError } from '../../../plugins/error-handler';
import type { RequestContext } from '../../../plugins/request-context';
import { recordAudit } from '../../audit/audit';
import { toStoredCompanyKey } from '../../facial/stored-crypto';
import { TenantRepository } from '../tenants/repository';
import { isValidCnpj } from '../tenants/rules/cnpj';
import { OrganizationRepository, type CompanyRow } from './repository';
import type {
  CompanyDto,
  CreateCompanyBody,
  CreateEstablishmentBody,
  EstablishmentDto,
  UpdateCompanyBody,
  UpdateEstablishmentBody,
} from './schemas';

export interface OrganizationServiceDeps {
  db: Database;
  clock: Clock;
  masterKeyHex: string | null;
}

const invalidCnpj = () => new HttpError(400, 'CNPJ_INVALIDO', 'CNPJ inválido: confira os dígitos verificadores');
const registrationInUse = () =>
  new HttpError(409, 'REGISTRO_EM_USO', 'Já há colaborador ligado a este registro: o número não pode mais ser alterado');

/** UNIQUE do banco → erro do contrato. Cobre também a corrida entre dois cadastros. */
const DUPLICATES: Readonly<Record<string, () => HttpError>> = {
  empresa_cnpj_unico: () => new HttpError(409, 'CNPJ_DUPLICADO', 'Já existe uma empresa com esse CNPJ nesta conta'),
  estab_inscricao_unica: () => new HttpError(409, 'INSCRICAO_DUPLICADA', 'Já existe um estabelecimento com essa inscrição nesta empresa'),
};

/** Só os campos enviados que mudam de fato. */
function changedFields<T extends object>(current: T, patch: { [K in keyof T]?: T[K] | undefined }): Partial<T> {
  return Object.fromEntries(
    Object.entries(patch).filter(([key, value]) => value !== undefined && value !== current[key as keyof T]),
  ) as Partial<T>;
}

function pick<T extends object>(source: T, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.map((k) => [k, source[k as keyof T]]));
}

/** Inscrição de pessoa física é um CPF: não vai para a auditoria. */
function auditable(data: Record<string, unknown>, registrationType: string): Record<string, unknown> {
  const { registration } = data;
  if (typeof registration !== 'string' || (registrationType !== 'CPF' && registration.length !== 11)) return data;
  return { ...data, registration: '[alterado]' };
}

export class OrganizationService {
  constructor(
    private readonly d: OrganizationServiceDeps,
    private readonly repo = new OrganizationRepository(),
    private readonly inserts = new TenantRepository(),
  ) {}

  async listCompanies(tenantId: number): Promise<CompanyDto[]> {
    await this.mustTenant(this.d.db, tenantId);
    const [companies, establishments] = await Promise.all([
      this.repo.companies(this.d.db, tenantId),
      this.repo.establishments(this.d.db, tenantId),
    ]);
    return companies.map((c) => ({ ...c, establishments: establishments.filter((e) => e.companyId === c.id) }));
  }

  async createCompany(ctx: RequestContext, tenantId: number, body: CreateCompanyBody): Promise<CompanyDto> {
    const masterKeyHex = this.d.masterKeyHex;
    if (masterKeyHex === null) throw new HttpError(503, 'MASTER_KEY_AUSENTE', 'Chave mestra não configurada: não é possível criar empresas agora');
    if (!isValidCnpj(body.cnpj)) throw invalidCnpj();

    return this.write(async (tx) => {
      await this.mustTenant(tx, tenantId);
      const id = await this.inserts.insertCompany(tx, tenantId, body.legalName, body.cnpj);
      await this.inserts.insertCompanyKey(tx, tenantId, id, toStoredCompanyKey(encryptDek(generateDek(), masterKeyHex), 1));
      await recordAudit(tx, this.d.clock, {
        tenantId,
        userId: ctx.userId,
        entity: 'company',
        entityId: id,
        action: 'criacao',
        after: { legalName: body.legalName, cnpj: body.cnpj },
      });
      return { id, legalName: body.legalName, cnpj: body.cnpj, isActive: true, establishments: [] };
    });
  }

  async updateCompany(ctx: RequestContext, tenantId: number, companyId: number, body: UpdateCompanyBody): Promise<CompanyDto> {
    return this.write(async (tx) => {
      const before = await this.mustCompany(tx, tenantId, companyId, 'update');
      const changes = changedFields<CompanyRow>(before, body);
      if (changes.cnpj !== undefined) {
        if (!isValidCnpj(changes.cnpj)) throw invalidCnpj();
        await this.repo.lockEstablishmentsOf(tx, tenantId, companyId);
        if (await this.repo.companyHasEmployees(tx, tenantId, companyId)) throw registrationInUse();
      }
      const keys = Object.keys(changes);
      if (keys.length > 0) {
        await this.repo.updateCompany(tx, tenantId, companyId, changes);
        await recordAudit(tx, this.d.clock, {
          tenantId,
          userId: ctx.userId,
          entity: 'company',
          entityId: companyId,
          action: 'alteracao',
          before: pick(before, keys),
          after: { ...changes },
        });
      }
      return { ...before, ...changes, establishments: await this.repo.establishments(tx, tenantId, companyId) };
    });
  }

  async createEstablishment(ctx: RequestContext, tenantId: number, companyId: number, body: CreateEstablishmentBody): Promise<EstablishmentDto> {
    return this.write(async (tx) => {
      const company = await this.mustCompany(tx, tenantId, companyId, 'share');
      if (!company.isActive) throw new HttpError(409, 'EMPRESA_INATIVA', 'A empresa está inativa: reative antes de criar estabelecimentos');
      if (body.registrationType === 'CNPJ' && !isValidCnpj(body.registration)) throw invalidCnpj();
      const id = await this.inserts.insertEstablishment(tx, tenantId, companyId, body);
      await recordAudit(tx, this.d.clock, {
        tenantId,
        userId: ctx.userId,
        entity: 'establishment',
        entityId: id,
        action: 'criacao',
        after: auditable({ companyId, ...body }, body.registrationType),
      });
      return { id, companyId, ...body, isActive: true };
    });
  }

  async updateEstablishment(ctx: RequestContext, tenantId: number, establishmentId: number, body: UpdateEstablishmentBody): Promise<EstablishmentDto> {
    return this.write(async (tx) => {
      const before = await this.repo.establishment(tx, tenantId, establishmentId, true);
      if (!before) throw notFound('Estabelecimento');
      const changes = changedFields<EstablishmentDto>(before, body);
      const after = { ...before, ...changes };
      if (changes.registrationType !== undefined || changes.registration !== undefined) {
        if (after.registrationType === 'CNPJ' && !isValidCnpj(after.registration)) throw invalidCnpj();
        if (await this.repo.establishmentHasEmployees(tx, tenantId, establishmentId)) throw registrationInUse();
      }
      const keys = Object.keys(changes);
      if (keys.length > 0) {
        await this.repo.updateEstablishment(tx, tenantId, establishmentId, changes);
        await recordAudit(tx, this.d.clock, {
          tenantId,
          userId: ctx.userId,
          entity: 'establishment',
          entityId: establishmentId,
          action: 'alteracao',
          before: auditable(pick(before, keys), before.registrationType),
          after: auditable({ ...changes }, after.registrationType),
        });
      }
      return after;
    });
  }

  // ---------------------------------------------------------------------------------------------

  private async write<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    try {
      return await this.d.db.transaction(fn);
    } catch (err) {
      const duplicate = DUPLICATES[pgError(err)?.constraint ?? ''];
      if (duplicate) throw duplicate();
      throw err;
    }
  }

  private async mustTenant(ex: Executor, tenantId: number): Promise<void> {
    if (!(await this.repo.tenantExists(ex, tenantId))) throw notFound('Conta');
  }

  /** Empresa de outra conta responde igual a empresa inexistente. */
  private async mustCompany(ex: Executor, tenantId: number, companyId: number, lock: 'update' | 'share'): Promise<CompanyRow> {
    const row = await this.repo.company(ex, tenantId, companyId, lock);
    if (!row) throw notFound('Empresa');
    return row;
  }
}
