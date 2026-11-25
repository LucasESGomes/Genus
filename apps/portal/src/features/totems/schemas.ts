import { z } from 'zod';

export const deviceFormSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome do totem (mínimo de 2 letras).').max(80, 'O nome pode ter até 80 caracteres.'),
  establishmentId: z.string().min(1, 'Escolha o estabelecimento.'),
  isActive: z.boolean(),
});
export type DeviceFormValues = z.output<typeof deviceFormSchema>;
