/**
 * Provisiona uma conta (tenant) de cliente: conta, empresa, estabelecimento, chave da empresa (DEK) e o
 * primeiro usuário `admin`. Serve para o primeiro acesso em produção, enquanto o painel do super_admin
 * (CRUD de contas, POST /portal/super-admin/tenants) não esteja em uso. Idempotente por nome da conta / CNPJ / e-mail. Dados da empresa são
 * PLACEHOLDERS: corrija no portal (Configurações) antes de usar de verdade.
 *
 *   MASTER_KEY=<64 hex, a mesma da engine> RH_MIGRATION_DATABASE_URL=... NEW_USER_PASSWORD=... \
 *   ADMIN_EMAIL=admin@empresa.com ADMIN_NAME="Admin" TENANT_NAME="Minha Empresa" \
 *   [COMPANY_NAME=... COMPANY_CNPJ=14 dígitos ESTABLISHMENT_NAME=...] tsx scripts/provision-tenant.ts
 */
import { createLogger, SystemClock } from '@genus/shared';
import { createDatabase } from '../src/db/client';
import { recordAudit } from '../src/modules/audit/audit';
import { UserService } from '../src/modules/auth/user-service';
import { TenantRepository } from '../src/modules/super-admin/tenants/repository';
import { provisionStructure } from '../src/modules/super-admin/tenants/service';

const need = (n: string): string => {
  const v = process.env[n];
  if (!v) throw new Error(`Defina ${n}`);
  return v;
};

const masterKey = need('MASTER_KEY');
if (!/^[0-9a-fA-F]{64}$/.test(masterKey)) throw new Error('MASTER_KEY deve ter 64 hex');
const ownerUrl = need('RH_MIGRATION_DATABASE_URL');
const tenantName = need('TENANT_NAME');
const adminEmail = need('ADMIN_EMAIL');
const adminName = need('ADMIN_NAME');
const password = need('NEW_USER_PASSWORD');
const companyName = process.env.COMPANY_NAME ?? `${tenantName} (editar)`;
const cnpj = process.env.COMPANY_CNPJ ?? '11222333000181';
const establishmentName = process.env.ESTABLISHMENT_NAME ?? 'Matriz (editar)';
const inscricao = `${cnpj.slice(0, 8)}0001`.padEnd(12, '0');

// Papel dono (rh_owner), como antes: o script roda no primeiro acesso, antes de existir qualquer usuário.
const database = createDatabase(ownerUrl, createLogger({ level: 'warn', service: 'provision-tenant' }), 2);
const clock = new SystemClock();
const repo = new TenantRepository();

try {
  const existing = await repo.emailExists(database.db, adminEmail);
  const result = await database.db.transaction(async (tx) => {
    const s = await provisionStructure(
      repo,
      tx,
      {
        tenantName,
        legalName: companyName,
        cnpj,
        establishment: { name: establishmentName, registrationType: 'CAEPF', registration: inscricao, uf: 'GO', municipalityIbge: '5218805' },
        masterKeyHex: masterKey,
      },
      { reuse: true },
    );
    if (s.createdTenant) await recordAudit(tx, clock, { tenantId: s.tenantId, userId: null, entity: 'tenant', entityId: s.tenantId, action: 'criacao', after: { name: tenantName } });
    if (!existing) {
      const admin = await new UserService({ db: database.db }).createUser(
        { email: adminEmail, name: adminName, role: 'admin', tenantId: s.tenantId, employeeId: null, password },
        tx,
      );
      await recordAudit(tx, clock, { tenantId: s.tenantId, userId: null, entity: 'tenant_admin', entityId: admin.id, action: 'criacao', after: { role: 'admin' } });
    }
    return s;
  });
  process.stdout.write(
    `ok: conta=${result.tenantId} empresa=${result.companyId} estabelecimento=${result.establishmentId} admin=${adminEmail} ${existing ? '(já existia)' : '(criado)'}
`,
  );
} catch (err) {
  process.stderr.write(`Falha: ${(err as Error).message}
`);
  process.exitCode = 1;
} finally {
  await database.close();
}
