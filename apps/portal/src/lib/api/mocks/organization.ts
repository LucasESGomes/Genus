/** Mock de empresas e estabelecimentos. Parte das empresas do mock do super_admin; escritas ficam em memória. */
import { isValidCnpj, onlyDigits } from '../../cnpj';
import type { EntityId } from '../contracts';
import type { OrganizationApi } from '../endpoints/organization';
import type { Company } from '../organization-contracts';
import { clone, delay, mockFail, mockId, mockNotFound } from './runtime';
import { mockSuperAdminApi } from './super-admin';

const db = new Map<EntityId, Company[]>();
export const resetMockOrganization = () => db.clear();

async function companiesOf(tenantId: EntityId): Promise<Company[]> {
  let rows = db.get(tenantId);
  if (!rows) {
    const tenant = await mockSuperAdminApi.tenants.get(tenantId);
    rows = tenant.companies.map((co) => ({
      ...co,
      establishments: [{
        id: `${co.id}01`, companyId: co.id, name: 'Matriz', registrationType: 'CNPJ' as const, registration: co.cnpj,
        uf: 'GO', municipalityIbge: '5218805', isActive: co.isActive,
      }],
    }));
    db.set(tenantId, rows);
  }
  return rows;
}

function checkCnpj(rows: Company[], cnpj: string, selfId?: EntityId) {
  if (!isValidCnpj(cnpj)) throw mockFail(400, 'CNPJ_INVALIDO', 'CNPJ inválido');
  if (rows.some((c) => c.id !== selfId && c.cnpj === onlyDigits(cnpj))) throw mockFail(409, 'CNPJ_DUPLICADO', 'CNPJ já cadastrado');
}

function checkRegistration(rows: Company[], registration: string, selfId?: EntityId) {
  if (rows.some((c) => c.establishments.some((e) => e.id !== selfId && e.registration === registration))) {
    throw mockFail(409, 'INSCRICAO_DUPLICADA', 'Inscrição já cadastrada');
  }
}

export const mockOrganizationApi: OrganizationApi = {
  companies: async (tenantId) => {
    await delay();
    return clone(await companiesOf(tenantId));
  },
  createCompany: async (tenantId, input) => {
    await delay();
    const rows = await companiesOf(tenantId);
    checkCnpj(rows, input.cnpj);
    const company: Company = { id: mockId(), legalName: input.legalName, cnpj: onlyDigits(input.cnpj), isActive: true, establishments: [] };
    rows.push(company);
    return clone(company);
  },
  updateCompany: async (tenantId, companyId, input) => {
    await delay();
    const rows = await companiesOf(tenantId);
    const company = rows.find((c) => c.id === companyId);
    if (!company) throw mockNotFound();
    if (input.cnpj !== undefined) checkCnpj(rows, input.cnpj, companyId);
    Object.assign(company, input);
    return clone(company);
  },
  createEstablishment: async (tenantId, companyId, input) => {
    await delay();
    const rows = await companiesOf(tenantId);
    const company = rows.find((c) => c.id === companyId);
    if (!company) throw mockNotFound();
    if (!company.isActive) throw mockFail(409, 'EMPRESA_INATIVA', 'Empresa inativa');
    checkRegistration(rows, input.registration);
    const row = { ...input, id: mockId(), companyId, isActive: true };
    company.establishments.push(row);
    return clone(row);
  },
  updateEstablishment: async (tenantId, establishmentId, input) => {
    await delay();
    const rows = await companiesOf(tenantId);
    const row = rows.flatMap((c) => c.establishments).find((e) => e.id === establishmentId);
    if (!row) throw mockNotFound();
    if (input.registration !== undefined) checkRegistration(rows, input.registration, establishmentId);
    Object.assign(row, input);
    return clone(row);
  },
};
