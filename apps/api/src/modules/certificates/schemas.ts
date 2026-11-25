/**
 * Contratos HTTP de atestado (G7, RF27, RF28, RF32). Dado de saúde (RN15, LGPD
 * art. 11): NENHUMA resposta tem CID (nem cifrado), hash do arquivo ou texto de
 * OCR. Médico e arquivo só para o RH. O colaborador vê status e motivo.
 */
import { z } from 'zod';
import { civilDate, listMeta, pagination, positiveId, reasonText } from '../../http/schemas';
import { searchText } from '../../http/search';

export const CERTIFICATE_STATUSES = ['pendente', 'aprovado', 'recusado'] as const;

export const listCertificatesQuery = pagination.extend({
  status: z.enum(CERTIFICATE_STATUSES).optional(),
  employeeId: positiveId.optional(),
  /** Nome ou matrícula do colaborador. */
  q: searchText.optional(),
});

export const rejectCertificateBody = z.object({ reason: reasonText });

/** Campos do multipart de envio (o arquivo vai no campo `file`). */
export const submitCertificateFields = z
  .object({
    startDate: civilDate,
    days: z.coerce.number().int().min(1).max(365).optional(),
    hours: z.coerce.number().int().min(1).max(24).optional(),
    doctorName: z.string().trim().min(2).max(200).optional(),
    doctorCrm: z.string().trim().regex(/^[0-9]{1,10}$/, 'só os números do CRM').optional(),
    doctorCrmUf: z.string().regex(/^[A-Z]{2}$/, 'UF em maiúsculas').optional(),
  })
  .refine((b) => (b.days === undefined) !== (b.hours === undefined), { path: ['days'], message: 'informe dias ou horas (um dos dois)' });

/** Visão comum (admin e gestor): "afastado de D1 a D2", sem diagnóstico (04 G7). */
export const certificateDto = z.object({
  id: z.number(),
  employeeId: z.number(),
  startDate: z.string(),
  days: z.number().nullable(),
  hours: z.number().nullable(),
  status: z.enum(CERTIFICATE_STATUSES),
  sentAt: z.string(),
  decidedAt: z.string().nullable(),
});

/** Visão do RH: + médico e link do arquivo. Ainda sem CID (gravação do CID fica para depois). */
export const certificateRhDto = certificateDto.extend({
  doctorName: z.string().nullable(),
  doctorCrm: z.string().nullable(),
  doctorCrmUf: z.string().nullable(),
  decisionReason: z.string().nullable(),
  fileUrl: z.string(),
});

/** Visão do próprio colaborador (RF27): status e motivo da decisão. */
export const myCertificateDto = certificateDto.extend({ decisionReason: z.string().nullable() });

export const certificateListResponse = z.object({ data: z.array(z.union([certificateRhDto, certificateDto])), meta: listMeta });
export const certificateRhResponse = z.object({ data: certificateRhDto });
export const myCertificateResponse = z.object({ data: myCertificateDto });
export const myCertificateListResponse = z.object({ data: z.array(myCertificateDto) });
