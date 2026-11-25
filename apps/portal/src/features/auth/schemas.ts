import { z } from 'zod';
import { COPY } from './copy';

export const passwordSchema = z.object({
  email: z.string().trim().min(1, COPY.emailRequired).pipe(z.email(COPY.emailInvalid)),
  password: z.string().min(1, COPY.passwordRequired),
});

export const totpSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, COPY.codeInvalid),
});

export type PasswordValues = z.output<typeof passwordSchema>;
export type TotpValues = z.output<typeof totpSchema>;
