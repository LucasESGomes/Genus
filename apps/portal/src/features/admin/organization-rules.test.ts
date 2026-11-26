import { describe, expect, it } from 'vitest';
import type { Company, CompanyEstablishment } from '@/lib/api/organization-contracts';
import { companyPatch, establishmentInput, establishmentPatch, establishmentSchema, needsBranchCnpj } from './organization-rules';

const CNPJ = '11222333000181';
const company: Company = { id: '1', legalName: 'Fazenda Teste Ltda', cnpj: CNPJ, isActive: true, establishments: [] };
const row: CompanyEstablishment = {
  id: '2', companyId: '1', name: 'Matriz', registrationType: 'CNPJ', registration: CNPJ, uf: 'GO', municipalityIbge: '5218805', isActive: true,
};
const values = { name: 'Matriz', registrationType: 'CNPJ' as const, registration: CNPJ, uf: 'GO', municipalityIbge: '5218805' };

describe('formulários de empresa e estabelecimento', () => {
  it('a edição manda só o que mudou (máscara não conta como mudança)', () => {
    expect(companyPatch(company, { legalName: 'Fazenda Teste Ltda', cnpj: '11.222.333/0001-81' })).toEqual({});
    expect(companyPatch(company, { legalName: 'Fazenda Nova Ltda', cnpj: CNPJ })).toEqual({ legalName: 'Fazenda Nova Ltda' });
    expect(establishmentPatch(row, values, CNPJ)).toEqual({});
    expect(establishmentPatch(row, { ...values, name: 'Sede' }, CNPJ)).toEqual({ name: 'Sede' });
  });
  it('só a filial informa CNPJ próprio: a matriz usa o da empresa', () => {
    const withHeadOffice = { ...company, establishments: [row] };
    expect(needsBranchCnpj(company, null)).toBe(false);
    expect(needsBranchCnpj(withHeadOffice, null)).toBe(true);
    expect(needsBranchCnpj(withHeadOffice, row)).toBe(false);
    expect(needsBranchCnpj(company, { ...row, registration: '11222333000262' })).toBe(true);
  });
  it('inscrição em branco: CNPJ usa o da empresa; CPF e CAEPF exigem o número', () => {
    expect(establishmentInput({ ...values, registration: '' }, CNPJ).registration).toBe(CNPJ);
    expect(establishmentSchema.safeParse({ ...values, registration: '' }).success).toBe(true);
    expect(establishmentSchema.safeParse({ ...values, registrationType: 'CAEPF', registration: '' }).success).toBe(false);
  });
});
