import { z } from 'zod';

/** `subtitle` = razão social da empresa. */
export const establishmentOptionDto = z.strictObject({ id: z.number(), name: z.string(), subtitle: z.string(), isActive: z.boolean() });
export type EstablishmentOptionDto = z.infer<typeof establishmentOptionDto>;

export const establishmentOptionListResponse = z.strictObject({ data: z.array(establishmentOptionDto) });
