/** Payloads dos jobs: SÓ IDs (nenhum dado pessoal, nenhuma imagem). */
import { z } from 'zod';

const id = z
  .number()
  .int()
  .positive()
  .refine(Number.isSafeInteger, 'deve ser um inteiro seguro');

export const punchPayloadSchema = z.strictObject({
  entryId: id,
  tenantId: id,
  establishmentId: id,
});
export type PunchJobData = z.infer<typeof punchPayloadSchema>;

export const postPunchPayloadSchema = z.strictObject({
  outboxId: id,
  tenantId: id,
  establishmentId: id,
  nsr: id,
});
export type PostPunchJobData = z.infer<typeof postPunchPayloadSchema>;
