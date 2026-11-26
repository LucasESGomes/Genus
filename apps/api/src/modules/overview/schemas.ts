/** Contrato HTTP da visão geral (G11). */
import { z } from 'zod';
import { civilDate, positiveId } from '../../http/schemas';

export const overviewQuery = z
  .object({ establishmentId: positiveId, from: civilDate.optional(), to: civilDate.optional() })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { path: ['to'], message: 'o fim vem depois do início' })
  .refine((q) => !q.from || !q.to || (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 <= 92, { path: ['to'], message: 'no máximo 93 dias' });

export const KPI_KEYS = ['workedHours', 'overtimeHours', 'absences', 'pendingAdjustments', 'pendingCertificates', 'activeVacations', 'timeBankBalance'] as const;
export const ALERT_TARGETS = ['apuracao', 'escalas', 'colaboradores', 'ajustes', 'atestados', 'banco-horas'] as const;

const kpi = z.strictObject({
  key: z.enum(KPI_KEYS),
  label: z.string(),
  value: z.string(),
  unit: z.string(),
  delta: z.string(),
  trend: z.enum(['up', 'down']),
  tone: z.enum(['good', 'warn', 'neutral']),
  comparison: z.string(),
});

const alert = z.strictObject({
  id: z.string(),
  severity: z.enum(['alerta', 'sinal']),
  title: z.string(),
  text: z.string(),
  cta: z.string(),
  target: z.enum(ALERT_TARGETS),
});

const seriesPoint = z.strictObject({
  date: z.string(),
  workedMinutes: z.number(),
  overtimeMinutes: z.number(),
  absences: z.number(),
  inconsistent: z.number(),
});

export const overviewDto = z.strictObject({
  period: z.strictObject({ from: z.string(), to: z.string() }),
  previousPeriod: z.strictObject({ from: z.string(), to: z.string() }),
  /** Colaboradores ativos no escopo (sem desligamento). */
  activeEmployees: z.number(),
  /** Zero = nenhum dia apurado no período (empresa nova ou período futuro). */
  calculatedDays: z.number(),
  kpis: z.array(kpi),
  series: z.array(seriesPoint),
  statusBreakdown: z.strictObject({ calculada: z.number(), inconsistente: z.number(), falta: z.number() }),
  topOvertime: z.array(z.strictObject({ employeeId: z.number(), name: z.string(), overtimeMinutes: z.number() })),
  alerts: z.array(alert),
});
export type OverviewDto = z.infer<typeof overviewDto>;

export const overviewResponse = z.object({ data: overviewDto });
