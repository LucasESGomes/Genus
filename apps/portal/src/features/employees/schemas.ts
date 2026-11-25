/** Formulários de colaborador e vínculo (zod v4). A validação do CPF é só para a pessoa errar menos: a api decide. */
import { z } from 'zod';
import { CONTRACT_TYPES } from '@/lib/api/contracts';
import { cpfLooksValid, digitsOf } from '@/lib/cpf';

const civil = (msg: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, msg);
export const NONE = 'none';

export { cpfLooksValid, digitsOf, maskCpf } from '@/lib/cpf';

export const createEmployeeSchema = z
  .object({
    establishmentId: z.string().min(1, 'Escolha o estabelecimento.'),
    cpf: z.string().refine((v) => cpfLooksValid(digitsOf(v)), 'CPF inválido: confira os números.'),
    name: z.string().trim().min(2, 'Informe o nome (pelo menos 2 letras).').max(200, 'O nome pode ter até 200 letras.'),
    registrationNumber: z.string().trim().max(40, 'A matrícula pode ter até 40 caracteres.'),
    birthDate: civil('Informe a data de nascimento.'),
    admissionDate: civil('Informe a data de admissão.'),
    managerId: z.string(),
  })
  .refine((v) => !v.birthDate || !v.admissionDate || v.admissionDate >= v.birthDate, { path: ['admissionDate'], message: 'A admissão não pode ser antes do nascimento.' });
export type CreateEmployeeForm = z.input<typeof createEmployeeSchema>;

export const editEmployeeSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome (pelo menos 2 letras).').max(200, 'O nome pode ter até 200 letras.'),
  registrationNumber: z.string().trim().max(40, 'A matrícula pode ter até 40 caracteres.'),
  birthDate: civil('Informe a data de nascimento.'),
  managerId: z.string(),
});
export type EditEmployeeForm = z.input<typeof editEmployeeSchema>;

const money = /^\d{1,10}([.,]\d{1,2})?$/;

export const assignmentSchema = z
  .object({
    jobTitleId: z.string().min(1, 'Escolha o cargo.'),
    departmentId: z.string().min(1, 'Escolha o setor.'),
    costCenterId: z.string(),
    contractType: z.enum(CONTRACT_TYPES),
    baseSalary: z.string().trim().refine((v) => v === '' || money.test(v), 'Use o valor em reais, com até 2 casas (ex.: 2500,00).'),
    validFrom: civil('Informe o início da vigência.'),
    validTo: z.string().refine((v) => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Data inválida.'),
  })
  .refine((v) => v.validTo === '' || v.validTo >= v.validFrom, { path: ['validTo'], message: 'O fim não pode ser antes do início.' });
export type AssignmentForm = z.input<typeof assignmentSchema>;

/** "2500,5" → "2500.50" (texto, como a api espera). */
export const salaryToApi = (v: string): string | null => {
  const t = v.trim();
  if (!t) return null;
  const [int = '', frac = ''] = t.replace(',', '.').split('.');
  return `${int}.${frac.padEnd(2, '0')}`;
};
