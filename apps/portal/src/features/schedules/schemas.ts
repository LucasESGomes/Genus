/** Formulário de escala (zod v4). Formato HH:mm ↔ minutos é só conversão de formato, sem regra de jornada. */
import { z } from 'zod';
import { CYCLE_TYPES, SCHEDULE_TYPES, type Schedule, type ScheduleDay, type ScheduleDayInput } from '@/lib/api/contracts';

export const parseHours = (v: string): number | null => {
  const m = /^(\d{1,3}):([0-5]\d)$/.exec(v.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

export const scheduleSchema = z
  .object({
    establishmentId: z.string().min(1, 'Escolha o estabelecimento.'),
    name: z.string().trim().min(2, 'Informe o nome (pelo menos 2 letras).').max(100, 'O nome pode ter até 100 letras.'),
    type: z.enum(SCHEDULE_TYPES),
    cycleType: z.enum(CYCLE_TYPES),
    cycleDays: z.string(),
    referenceDate: z.string(),
    weeklyHours: z.string().refine((v) => { const m = parseHours(v); return m !== null && m > 0 && m <= 7 * 24 * 60; }, 'Use HH:mm, por exemplo 44:00.'),
  })
  .superRefine((v, ctx) => {
    if (v.cycleType !== 'ciclico') return;
    const n = Number(v.cycleDays);
    if (!Number.isInteger(n) || n < 2 || n > 60) ctx.addIssue({ code: 'custom', path: ['cycleDays'], message: 'Informe de 2 a 60 dias.' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.referenceDate)) ctx.addIssue({ code: 'custom', path: ['referenceDate'], message: 'Informe a data de referência.' });
  });
export type ScheduleForm = z.input<typeof scheduleSchema>;

export interface DayDraft {
  isDayOff: boolean;
  startTime: string;
  endTime: string;
  breakStartTime: string;
  breakEndTime: string;
  crossesMidnight: boolean;
}

export const blankDay = (): DayDraft => ({ isDayOff: false, startTime: '', endTime: '', breakStartTime: '', breakEndTime: '', crossesMidnight: false });

export const draftOf = (d: ScheduleDay): DayDraft => ({
  isDayOff: d.isDayOff, startTime: d.startTime ?? '', endTime: d.endTime ?? '', breakStartTime: d.breakStartTime ?? '', breakEndTime: d.breakEndTime ?? '', crossesMidnight: d.crossesMidnight,
});

export const draftsOf = (s: Schedule): Record<number, DayDraft> => Object.fromEntries(s.days.map((d) => [d.position, draftOf(d)]));

/** Dias de entrada para a api; devolve a mensagem do primeiro problema (a api valida de novo). */
export function buildDays(count: number, drafts: Record<number, DayDraft>): { days: ScheduleDayInput[] } | { error: string } {
  const days: ScheduleDayInput[] = [];
  for (let p = 0; p < count; p++) {
    const d = drafts[p] ?? blankDay();
    if (d.isDayOff) {
      days.push({ position: p, isDayOff: true });
      continue;
    }
    if (!d.startTime || !d.endTime) return { error: `Dia ${p + 1}: informe entrada e saída, ou marque como folga.` };
    if (!!d.breakStartTime !== !!d.breakEndTime) return { error: `Dia ${p + 1}: o intervalo precisa de início e fim.` };
    days.push({
      position: p, isDayOff: false, startTime: d.startTime, endTime: d.endTime,
      breakStartTime: d.breakStartTime || null, breakEndTime: d.breakEndTime || null, crossesMidnight: d.crossesMidnight,
    });
  }
  return { days };
}
