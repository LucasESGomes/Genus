/**
 * Contas (tenants) do painel do super_admin. Toda escrita é auditada na mesma transação.
 *
 * Criar conta = UMA transação: conta, empresa, estabelecimento, chave da empresa (DEK cifrada pela
 * MASTER_KEY) e o primeiro usuário `admin`, com senha temporária devolvida uma única vez (nunca gravada em
 * claro nem logada). Suspender derruba as sessões da conta; reativar limpa a suspensão.
 */
import { randomBytes } from 'node:crypto';
import { encryptDek, generateDek, type Clock } from '@genus/shared';
import type { z } from 'zod';
import type { Database } from '../../../db/client';
import type { Executor, Transaction } from '../../../db/executor';
import { notFound } from '../../../http/access';
import { HttpError, pgError } from '../../../plugins/error-handler';
import type { RequestContext } from '../../../plugins/request-context';
import { recordAudit } from '../../audit/audit';
import { UserService } from '../../auth/user-service';
import { toStoredCompanyKey } from '../../facial/stored-crypto';
import type { createTenantBody, listTenantsQuery, TenantDto, tenantDetailDto } from '../contract';
import { TenantRepository, type NewEstablishment, type TenantRow } from './repository';
import { isValidCnpj } from './rules/cnpj';

type TenantDetail = z.infer<typeof tenantDetailDto>;
type CreateBody = z.infer<typeof createTenantBody>;
type ListQuery = z.infer<typeof listTenantsQuery>;

export interface TenantServiceDeps {
  db: Database;
  clock: Clock;
  masterKeyHex: string | null;
}

export interface ProvisionInput {
  tenantName: string;
  legalName: string;
  cnpj: string;
  establishment: NewEstablishment;
  masterKeyHex: string;
}

export interface ProvisionedStructure {
  tenantId: number;
  companyId: number;
  establishmentId: number;
  createdTenant: boolean;
}

/**
 * Conta + empresa + estabelecimento + chave da empresa. Com `reuse`, acha o que já existe (por nome da
 * conta, CNPJ e inscrição) em vez de criar: é o que o script `provision-tenant` precisa para ser idempotente.
 */
export async function provisionStructure(
  repo: TenantRepository,
  ex: Executor,
  input: ProvisionInput,
  opts: { reuse: boolean },
): Promise<ProvisionedStructure> {
  const existingTenant = opts.reuse ? await repo.findTenantByName(ex, input.tenantName) : undefined;
  const tenantId = existingTenant ?? (await repo.insertTenant(ex, input.tenantName));

  const existingCompany = opts.reuse ? await repo.findCompanyByCnpj(ex, tenantId, input.cnpj) : undefined;
  const companyId = existingCompany ?? (await repo.insertCompany(ex, tenantId, input.legalName, input.cnpj));

  const existingEstablishment = opts.reuse ? await repo.findEstablishment(ex, companyId, input.establishment.registration) : undefined;
  const establishmentId = existingEstablishment ?? (await repo.insertEstablishment(ex, tenantId, companyId, input.establishment));

  if (!(await repo.hasActiveKeyForCompany(ex, tenantId, companyId))) {
    await repo.insertCompanyKey(ex, tenantId, companyId, toStoredCompanyKey(encryptDek(generateDek(), input.masterKeyHex), 1));
  }
  return { tenantId, companyId, establishmentId, createdTenant: existingTenant === undefined };
}

/** Senha temporária do primeiro admin: 16 caracteres aleatórios (base64url). */
export function generateTemporaryPassword(): string {
  return randomBytes(12).toString('base64url');
}

function toTenantDto(row: TenantRow): TenantDto {
  return {
    id: row.id,
    name: row.name,
    status: row.isActive ? 'ativa' : 'suspensa',
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    suspendedAt: row.suspendedAt?.toISOString() ?? null,
    suspensionReason: row.suspensionReason,
    counts: row.counts,
  };
}

export class TenantService {
  private readonly users: UserService;

  constructor(
    private readonly d: TenantServiceDeps,
    private readonly repo = new TenantRepository(),
  ) {
    this.users = new UserService({ db: d.db });
  }

  async list(q: ListQuery): Promise<{ data: TenantDto[]; meta: { page: number; pageSize: number; total: number } }> {
    const { rows, total } = await this.repo.list(this.d.db, { q: q.q, status: q.status, page: q.page, pageSize: q.pageSize });
    return { data: rows.map(toTenantDto), meta: { page: q.page, pageSize: q.pageSize, total } };
  }

  async get(tenantId: number): Promise<TenantDetail> {
    return this.detail(this.d.db, tenantId);
  }

  async create(ctx: RequestContext, body: CreateBody): Promise<{ tenant: TenantDetail; admin: { id: number; name: string; email: string }; temporaryPassword: string }> {
    const masterKeyHex = this.d.masterKeyHex;
    if (masterKeyHex === null) throw new HttpError(503, 'MASTER_KEY_AUSENTE', 'Chave mestra não configurada: não é possível criar contas agora');
    if (!isValidCnpj(body.company.cnpj)) throw new HttpError(400, 'CNPJ_INVALIDO', 'CNPJ inválido: confira os dígitos verificadores');
    if (await this.repo.emailExists(this.d.db, body.admin.email)) throw emailInUse();

    const temporaryPassword = generateTemporaryPassword();
    try {
      const created = await this.d.db.transaction(async (tx) => {
        const s = await provisionStructure(
          this.repo,
          tx,
          { tenantName: body.name, legalName: body.company.legalName, cnpj: body.company.cnpj, establishment: body.establishment, masterKeyHex },
          { reuse: false },
        );
        const admin = await this.users.createUser(
          { tenantId: s.tenantId, email: body.admin.email, name: body.admin.name, role: 'admin', employeeId: null, password: temporaryPassword },
          tx,
        );
        const audit = { tenantId: s.tenantId, userId: ctx.userId };
        await recordAudit(tx, this.d.clock, { ...audit, entity: 'tenant', entityId: s.tenantId, action: 'criacao', after: { name: body.name } });
        await recordAudit(tx, this.d.clock, { ...audit, entity: 'tenant_admin', entityId: admin.id, action: 'criacao', after: { role: 'admin' } });
        return { tenantId: s.tenantId, admin };
      });
      return {
        tenant: await this.detail(this.d.db, created.tenantId),
        admin: { id: created.admin.id, name: created.admin.name, email: created.admin.email },
        temporaryPassword,
      };
    } catch (err) {
      // Corrida: outro cadastro com o mesmo e-mail entre a checagem e o INSERT.
      if (pgError(err)?.constraint === 'usuario_email_key') throw emailInUse();
      throw err;
    }
  }

  async rename(ctx: RequestContext, tenantId: number, name: string): Promise<TenantDetail> {
    return this.d.db.transaction(async (tx) => {
      const before = await this.mustGet(tx, tenantId);
      if (before.name !== name) {
        await this.repo.rename(tx, tenantId, name);
        await recordAudit(tx, this.d.clock, {
          tenantId,
          userId: ctx.userId,
          entity: 'tenant',
          entityId: tenantId,
          action: 'alteracao',
          before: { name: before.name },
          after: { name },
        });
      }
      return this.detail(tx, tenantId);
    });
  }

  async suspend(ctx: RequestContext, tenantId: number, reason: string): Promise<TenantDetail> {
    return this.d.db.transaction(async (tx) => {
      const before = await this.mustGet(tx, tenantId, true);
      if (!before.isActive) throw new HttpError(409, 'TENANT_ALREADY_SUSPENDED', 'A conta já está suspensa');
      await this.repo.suspend(tx, tenantId, { userId: ctx.userId, at: this.d.clock.now(), reason });
      await recordAudit(tx, this.d.clock, {
        tenantId,
        userId: ctx.userId,
        entity: 'tenant',
        entityId: tenantId,
        action: 'alteracao',
        before: { status: 'ativa' },
        after: { status: 'suspensa' },
        reason,
      });
      return this.detail(tx, tenantId);
    });
  }

  async reactivate(ctx: RequestContext, tenantId: number, reason: string): Promise<TenantDetail> {
    return this.d.db.transaction(async (tx) => {
      const before = await this.mustGet(tx, tenantId, true);
      if (before.isActive) throw new HttpError(409, 'TENANT_NOT_SUSPENDED', 'A conta não está suspensa');
      await this.repo.reactivate(tx, tenantId);
      await recordAudit(tx, this.d.clock, {
        tenantId,
        userId: ctx.userId,
        entity: 'tenant',
        entityId: tenantId,
        action: 'alteracao',
        before: { status: 'suspensa', suspensionReason: before.suspensionReason },
        after: { status: 'ativa' },
        reason,
      });
      return this.detail(tx, tenantId);
    });
  }

  // ---------------------------------------------------------------------------------------------

  private async mustGet(ex: Executor, tenantId: number, lock = false): Promise<TenantRow> {
    const row = await this.repo.get(ex, tenantId, lock);
    if (!row) throw notFound('Conta');
    return row;
  }

  private async detail(ex: Executor | Transaction, tenantId: number): Promise<TenantDetail> {
    const row = await this.mustGet(ex, tenantId);
    const [companies, admins, hasCompanyKey] = await Promise.all([
      this.repo.companiesOf(ex, tenantId),
      this.repo.adminsOf(ex, tenantId),
      this.repo.hasCompanyKey(ex, tenantId),
    ]);
    return { ...toTenantDto(row), companies, admins, hasCompanyKey };
  }
}

const emailInUse = () => new HttpError(409, 'EMAIL_IN_USE', 'Já existe um usuário com esse e-mail na plataforma');
