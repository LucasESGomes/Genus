/**
 * Leitura e validação do multipart de POST /coletor/batidas. Os contratos de
 * resposta ficam em `@genus/shared`.
 */
import { ACCEPTED_IMAGE_MIMES, punchFieldsSchema, type PunchFields } from '@genus/shared';
import type { FastifyRequest } from 'fastify';
import { HttpError } from '../../plugins/error-handler';
import { detectImageType } from './rules/image-signature';

export interface ParsedPunchRequest {
  image: Buffer;
  imageMime: string;
  fields: PunchFields;
}

const FIELD_NAMES = ['deviceSequence', 'capturedAt'] as const;

export async function parsePunchRequest(req: FastifyRequest): Promise<ParsedPunchRequest> {
  if (!req.isMultipart()) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'A requisição deve ser multipart/form-data');
  }

  let image: Buffer | null = null;
  let imageMime = '';
  const rawFields: Record<string, string> = {};

  // Arquivo acima do limite: o toBuffer lança um erro 413 (tratado no error handler).
  for await (const part of req.parts()) {
    if (part.type === 'file') {
      if (part.fieldname !== 'image') {
        await part.toBuffer();
        throw new HttpError(400, 'VALIDATION_ERROR', 'Campo de arquivo inesperado', [
          { path: part.fieldname, message: 'apenas o campo image aceita arquivo' },
        ]);
      }
      image = await part.toBuffer();
      imageMime = part.mimetype;
    } else if ((FIELD_NAMES as readonly string[]).includes(part.fieldname)) {
      if (part.valueTruncated) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Campo muito longo', [
          { path: part.fieldname, message: 'valor longo demais' },
        ]);
      }
      rawFields[part.fieldname] = String(part.value);
    }
  }

  if (!image) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Imagem obrigatória', [
      { path: 'image', message: 'envie a imagem no campo image' },
    ]);
  }
  const declared = (ACCEPTED_IMAGE_MIMES as readonly string[]).includes(imageMime) ? imageMime : null;
  const detected = detectImageType(image);
  if (!declared || detected !== declared) {
    throw new HttpError(400, 'INVALID_IMAGE', 'Imagem inválida: envie JPEG ou PNG');
  }

  const fields = punchFieldsSchema.safeParse(rawFields);
  if (!fields.success) {
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      'Campos inválidos',
      fields.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return { image, imageMime: declared, fields: fields.data };
}
