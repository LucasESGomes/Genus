/**
 * Formulários de empresa e estabelecimento. A edição manda só o que mudou: reenviar CNPJ ou inscrição
 * iguais não pode esbarrar em REGISTRO_EM_USO. Inscrição em branco com tipo CNPJ usa o CNPJ da empresa.
 */
import { z } from 'zod';
import {
  REGISTRATION_TYPES, type Company, type CompanyEstablishment, type CreateCompanyInput, type CreateEstablishmentInput,
  type UpdateCompanyInput, type UpdateEstablishmentInput,
} from '@/lib/api/organization-contracts';
import { isValidCnpj, onlyDigits } from '@/lib/cnpj';
import { createTenantSchema } from './schemas';

export const companySchema = z.object({
  legalName: createTenantSchema.shape.legalName,
  cnpj: z.string().trim().refine((v) => isValidCnpj(v), 'CNPJ inválido. Confira os 14 dígitos.'),
});
export type CompanyValues = z.output<typeof companySchema>;

export const establishmentSchema = z
  .object({
    name: createTenantSchema.shape.establishmentName,
    registrationType: z.enum(REGISTRATION_TYPES),
    registration: createTenantSchema.shape.registration,
    uf: createTenantSchema.shape.uf,
    municipalityIbge: createTenantSchema.shape.municipalityIbge,
  })
  .superRefine((v, ctx) => {
    if (v.registrationType !== 'CNPJ' && onlyDigits(v.registration).length === 0) {
      ctx.addIssue({ code: 'custom', path: ['registration'], message: 'Informe o número do registro.' });
    }
  });
export type EstablishmentValues = z.output<typeof establishmentSchema>;

/** Só as chaves de `next` cujo valor é diferente do atual. */
function changed<T extends object>(current: T, next: T): Partial<T> {
  return Object.fromEntries(Object.entries(next).filter(([k, v]) => current[k as keyof T] !== v)) as Partial<T>;
}

export const companyInput = (v: CompanyValues): CreateCompanyInput => ({ legalName: v.legalName, cnpj: onlyDigits(v.cnpj) });

export const companyPatch = (current: Company, v: CompanyValues): UpdateCompanyInput =>
  changed<CreateCompanyInput>({ legalName: current.legalName, cnpj: current.cnpj }, companyInput(v));

export const establishmentInput = (v: EstablishmentValues, companyCnpj: string): CreateEstablishmentInput => ({
  name: v.name,
  registrationType: v.registrationType,
  registration: onlyDigits(v.registration) || (v.registrationType === 'CNPJ' ? companyCnpj : ''),
  uf: v.uf,
  municipalityIbge: v.municipalityIbge,
});

export const establishmentPatch = (current: CompanyEstablishment, v: EstablishmentValues, companyCnpj: string): UpdateEstablishmentInput =>
  changed<CreateEstablishmentInput>(
    { name: current.name, registrationType: current.registrationType, registration: current.registration, uf: current.uf, municipalityIbge: current.municipalityIbge },
    establishmentInput(v, companyCnpj),
  );
