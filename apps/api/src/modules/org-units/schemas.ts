/**
 * Contratos HTTP de setores, cargos e centros de custo (G1, RF02).
 * Setor é do estabelecimento; cargo e centro de custo são da empresa (o
 * estabelecimento da consulta só diz qual empresa).
 */
import { z } from 'zod';
import { positiveId } from '../../http/schemas';

const name = z.string().trim().min(2, 'mínimo de 2 letras').max(100);

export const orgUnitListQuery = z.object({ establishmentId: positiveId });

export const createDepartmentBody = z.object({
  establishmentId: positiveId,
  name,
  maxSimultaneousVacations: z.number().int().min(1).max(999).default(1),
});
export const updateDepartmentBody = z
  .object({ name, maxSimultaneousVacations: z.number().int().min(1).max(999) })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'envie ao menos um campo');

const cbo = z.string().regex(/^\d{6}$/, 'CBO tem 6 dígitos');
export const createJobTitleBody = z.object({ establishmentId: positiveId, name, cbo: cbo.nullable().optional() });
export const updateJobTitleBody = z
  .object({ name, cbo: cbo.nullable() })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'envie ao menos um campo');

const code = z.string().trim().min(1).max(30);
export const createCostCenterBody = z.object({ establishmentId: positiveId, code, name });
export const updateCostCenterBody = z
  .object({ code, name })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'envie ao menos um campo');

export const departmentDto = z.strictObject({
  id: z.number(),
  establishmentId: z.number(),
  name: z.string(),
  maxSimultaneousVacations: z.number(),
});
export const jobTitleDto = z.strictObject({ id: z.number(), companyId: z.number(), name: z.string(), cbo: z.string().nullable() });
export const costCenterDto = z.strictObject({ id: z.number(), companyId: z.number(), code: z.string(), name: z.string() });

export const departmentResponse = z.object({ data: departmentDto });
export const departmentListResponse = z.object({ data: z.array(departmentDto) });
export const jobTitleResponse = z.object({ data: jobTitleDto });
export const jobTitleListResponse = z.object({ data: z.array(jobTitleDto) });
export const costCenterResponse = z.object({ data: costCenterDto });
export const costCenterListResponse = z.object({ data: z.array(costCenterDto) });

export type DepartmentDto = z.infer<typeof departmentDto>;
export type JobTitleDto = z.infer<typeof jobTitleDto>;
export type CostCenterDto = z.infer<typeof costCenterDto>;
