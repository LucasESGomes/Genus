/** Formulário "Lançar férias" (zod v4). As faixas copiam as da api; a api valida de novo (e aplica as regras de férias). */
import { z } from 'zod';

const civil = (msg: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, msg);

export const launchVacationSchema = z
  .object({
    accrualPeriodId: z.string().min(1, 'Escolha o período aquisitivo.'),
    startDate: civil('Escolha o primeiro dia.'),
    endDate: civil('Escolha o último dia.'),
    cashBonusDays: z.string().regex(/^\d{1,2}$/, 'Informe de 0 a 10 dias.'),
  })
  .refine((v) => Number(v.cashBonusDays) <= 10, { path: ['cashBonusDays'], message: 'Informe de 0 a 10 dias.' })
  .refine((v) => v.endDate >= v.startDate, { path: ['endDate'], message: 'O último dia não pode ser antes do primeiro.' });
export type LaunchVacationForm = z.input<typeof launchVacationSchema>;
