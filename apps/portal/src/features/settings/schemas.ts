import { z } from 'zod';

const whole = (what: string) => z.number({ error: `Informe ${what}.` }).int('Use um número inteiro.');

/**
 * Parâmetros da empresa. São parâmetros da conta; a regra legal fica no servidor.
 * [A CONFIRMAR] o limite legal da tolerância de marcação: 60 aqui é só um teto de formulário, não regra trabalhista.
 */
export const settingsFormSchema = z.object({
  managerPortalEnabled: z.boolean(),
  maxSimultaneousVacationsPerDepartment: whole('o limite de férias simultâneas').min(1, 'O mínimo é 1.'),
  punchToleranceMinutes: whole('a tolerância em minutos').min(0, 'O mínimo é 0.').max(60, 'O máximo é 60 minutos.'),
});

export type SettingsFormInput = z.input<typeof settingsFormSchema>;
