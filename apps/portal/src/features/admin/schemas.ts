import { z } from 'zod';
import { isValidCnpj, onlyDigits } from '@/lib/cnpj';
import { cpfLooksValid } from '@/lib/cpf';

export const createTenantSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome da conta (mínimo de 2 letras).').max(120, 'O nome pode ter até 120 caracteres.'),
  legalName: z.string().trim().min(2, 'Informe a razão social.').max(160, 'A razão social pode ter até 160 caracteres.'),
  cnpj: z.string().trim().refine((v) => isValidCnpj(v), 'CNPJ inválido. Confira os 14 dígitos.'),
  establishmentName: z.string().trim().min(2, 'Informe o nome do estabelecimento.').max(120, 'O nome pode ter até 120 caracteres.'),
  registrationType: z.enum(['CNPJ', 'CPF', 'CAEPF']),
  registration: z.string().trim().max(20, 'Número de registro longo demais.'),
  uf: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'Selecione a UF.'),
  municipalityIbge: z.string().trim().regex(/^\d{7}$/, 'Selecione o município.'),
  adminName: z.string().trim().min(2, 'Informe o nome do administrador.').max(120, 'O nome pode ter até 120 caracteres.'),
  adminEmail: z.string().trim().min(1, 'Informe o e-mail.').email('Informe um e-mail válido.'),
  adminCpf: z.string().refine((v) => cpfLooksValid(onlyDigits(v)), 'CPF inválido. Confira os 11 dígitos.'),
}).superRefine((v, ctx) => {
  if (v.registrationType !== 'CNPJ' && onlyDigits(v.registration).length === 0) {
    ctx.addIssue({ code: 'custom', path: ['registration'], message: 'Informe o número do registro.' });
  }
});
export type CreateTenantValues = z.output<typeof createTenantSchema>;

export const tenantNameSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome da conta (mínimo de 2 letras).').max(120, 'O nome pode ter até 120 caracteres.'),
});
export type TenantNameValues = z.output<typeof tenantNameSchema>;

export const totpCodeSchema = z.object({ code: z.string().regex(/^\d{6}$/, 'O código tem 6 números.') });
export const passwordOnlySchema = z.object({ password: z.string().min(1, 'Informe a senha.') });
