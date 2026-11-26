/** Contratos HTTP da apuração (G4, RF17 a RF22). */
import { z } from 'zod';
import { civilDate, listMeta, pagination, positiveId } from '../../http/schemas';
import { searchText } from '../../http/search';
import { ISSUE_TYPES } from './issue-codes';

export const periodQuery = z.object({ from: civilDate, to: civilDate });
export const recalculateBody = periodQuery;

export const timesheetDayDto = z.object({
  date: z.string(),
  situation: z.string(),
  status: z.enum(['calculada', 'inconsistente']),
  scheduleId: z.number().nullable(),
  expectedMinutes: z.number(),
  workedMinutes: z.number(),
  absenceMinutes: z.number(),
  lateMinutes: z.number(),
  overtime50Minutes: z.number(),
  overtime100Minutes: z.number(),
  nightMinutes: z.number(),
  breakMinutes: z.number(),
  /** RNF06: as linhas de parâmetros legais usadas. */
  parameterVersion: z.string(),
  calculatedAt: z.string(),
  /** Visão resolvida do dia. A original fica no arp (só o NSR aqui) e nunca muda (RN01). */
  punches: z.array(
    z.object({
      sequence: z.number(),
      at: z.string(),
      origin: z.enum(['original', 'tratada']),
      nsr: z.number().nullable(),
      adjustmentId: z.number().nullable(),
    }),
  ),
  issues: z.array(z.object({ type: z.enum(ISSUE_TYPES), resolved: z.boolean() })),
});

export const timesheetListResponse = z.object({ data: z.array(timesheetDayDto) });
export const recalculateResponse = z.object({
  data: z.object({
    days: z.array(timesheetDayDto),
    /** Dias sem cálculo: sem escala vigente para o colaborador. */
    skipped: z.array(z.object({ date: z.string(), reason: z.enum(['sem_escala']) })),
  }),
});

/** Apuração do dia de todos os colaboradores do estabelecimento (`DayRowPage` do portal). */
export const dayRowsQuery = pagination.extend({
  date: civilDate,
  establishmentId: positiveId,
  departmentId: positiveId.optional(),
  /** `calculada` não inclui as faltas. */
  status: z.enum(['calculada', 'inconsistente', 'falta']).optional(),
  /** Nome ou matrícula. Dado pessoal: nunca em log. */
  q: searchText.optional(),
});

export const dayRowDto = timesheetDayDto
  .pick({ date: true, situation: true, status: true, punches: true, expectedMinutes: true, workedMinutes: true, absenceMinutes: true, issues: true })
  .extend({
    employeeId: z.number(),
    employeeName: z.string(),
    registrationNumber: z.string().nullable(),
    departmentName: z.string().nullable(),
    jobTitleName: z.string().nullable(),
    /** Dia sem nenhuma marcação em dia de trabalho encerrado. */
    isAbsence: z.boolean(),
    /** Extra a 50% e a 100% somadas. */
    overtimeMinutes: z.number(),
  });

export const dayRowsResponse = z.object({
  data: z.array(dayRowDto),
  meta: listMeta,
  /** Sobre o filtro sem `status`. */
  counts: z.object({ todos: z.number(), inconsistente: z.number(), falta: z.number(), calculada: z.number() }),
});

export const recalculateEstablishmentBody = z.object({ establishmentId: positiveId, date: civilDate });
export const recalculateEstablishmentResponse = z.object({
  data: z.object({
    recalculated: z.number(),
    skipped: z.array(z.object({ employeeId: z.number(), reason: z.enum(['sem_escala', 'periodo_fechado']) })),
  }),
});
