/**
 * Empresas e estabelecimentos de uma conta, no painel do super_admin
 * (docs/prompts/mvp-superadmin-orquestracao.md). Os campos de entrada são os mesmos de `POST /tenants`.
 */
import { z } from 'zod';
import { positiveId } from '../../../http/schemas';
import { createTenantBody, tenantIdParams } from '../contract';

const { company, establishment } = createTenantBody.shape;
const somethingToChange = (v: Record<string, unknown>) => Object.values(v).some((x) => x !== undefined);
const NOTHING = 'informe ao menos um campo';

export const companyParams = tenantIdParams.extend({ companyId: positiveId });
export const establishmentParams = tenantIdParams.extend({ establishmentId: positiveId });

export const createCompanyBody = company;
export const updateCompanyBody = company.partial().extend({ isActive: z.boolean().optional() }).refine(somethingToChange, NOTHING);
export const createEstablishmentBody = establishment;
export const updateEstablishmentBody = establishment.partial().extend({ isActive: z.boolean().optional() }).refine(somethingToChange, NOTHING);

export const establishmentDto = z.strictObject({
  id: z.number(),
  companyId: z.number(),
  name: z.string(),
  registrationType: establishment.shape.registrationType,
  registration: z.string(),
  uf: z.string(),
  municipalityIbge: z.string(),
  isActive: z.boolean(),
});
export const companyDto = z.strictObject({
  id: z.number(),
  legalName: z.string(),
  cnpj: z.string(),
  isActive: z.boolean(),
  establishments: z.array(establishmentDto),
});

export const companyListResponse = z.strictObject({ data: z.array(companyDto) });
export const companyResponse = z.strictObject({ data: companyDto });
export const establishmentResponse = z.strictObject({ data: establishmentDto });

export type CompanyDto = z.infer<typeof companyDto>;
export type EstablishmentDto = z.infer<typeof establishmentDto>;
export type CreateCompanyBody = z.infer<typeof createCompanyBody>;
export type UpdateCompanyBody = z.infer<typeof updateCompanyBody>;
export type CreateEstablishmentBody = z.infer<typeof createEstablishmentBody>;
export type UpdateEstablishmentBody = z.infer<typeof updateEstablishmentBody>;
