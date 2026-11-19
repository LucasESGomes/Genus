import type { AcceptedImageMime } from '@genus/shared';

const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(buf: Uint8Array, signature: number[]): boolean {
  return buf.length >= signature.length && signature.every((byte, i) => buf[i] === byte);
}

/** Tipo real da imagem pelos magic bytes; `null` se não for JPEG nem PNG. */
export function detectImageType(buf: Uint8Array): AcceptedImageMime | null {
  if (startsWith(buf, JPEG)) return 'image/jpeg';
  if (startsWith(buf, PNG)) return 'image/png';
  return null;
}
