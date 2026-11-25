import { z } from 'zod';
import { addCivilDays } from '@/lib/format';

const CIVIL = /^\d{4}-\d{2}-\d{2}$/;

/** Limite do intervalo: 366 dias, contando o primeiro e o último dia (to <= from + 365). */
export const MAX_REPORT_DAYS = 366;

/** Formulário de relatório. Estabelecimento vem da sessão e o tipo, do cartão escolhido: ficam fora do formulário. */
export const reportFormSchema = z
  .object({
    /** 'all' = todos os setores (o Select do Radix não aceita valor vazio). */
    departmentId: z.string(),
    from: z.string().regex(CIVIL, 'Informe a data inicial.'),
    to: z.string().regex(CIVIL, 'Informe a data final.'),
    format: z.enum(['pdf', 'csv']),
  })
  .superRefine((v, ctx) => {
    if (!CIVIL.test(v.from) || !CIVIL.test(v.to)) return;
    if (v.to < v.from) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'A data final vem antes da inicial.' });
    } else if (v.to > addCivilDays(v.from, MAX_REPORT_DAYS - 1)) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: `O período pode ter no máximo ${MAX_REPORT_DAYS} dias.` });
    }
  });

export type ReportFormInput = z.input<typeof reportFormSchema>;
