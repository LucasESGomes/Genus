/**
 * Cifra de coluna para dado de saúde da análise (CID, texto, evidências), RN15 e
 * LGPD art. 11. AES-256-GCM com `node:crypto`, chave `CERTIFICATE_DATA_KEY`
 * (32 bytes em hex). O AAD amarra o valor à conta, ao atestado e à coluna: copiar
 * o bytea para outra linha não decifra.
 *
 * Formato: versão (1 byte) | IV (12) | tag (16) | texto cifrado.
 * Tag inválida lança erro e NUNCA é silenciada (CLAUDE.md).
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 1;

export type HealthColumn = 'cid_cifrado' | 'ocr_texto_cifrado' | 'evidencias_cifradas';

export interface HealthAad {
  tenantId: number;
  certificateId: number;
  column: HealthColumn;
}

const aad = (a: HealthAad) => Buffer.from(`rh.analises_atestado:${a.tenantId}:${a.certificateId}:${a.column}`, 'utf8');

export class HealthDataCipher {
  private constructor(private readonly key: Buffer) {}

  /** null = sem chave configurada (a análise roda, mas não grava dado de saúde). */
  static fromHex(hex: string | null | undefined): HealthDataCipher | null {
    if (!hex) return null;
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('CERTIFICATE_DATA_KEY deve ter 64 caracteres hex (32 bytes)');
    return new HealthDataCipher(Buffer.from(hex, 'hex'));
  }

  encrypt(plain: string, where: HealthAad): Buffer {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(aad(where));
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), body]);
  }

  decrypt(data: Buffer, where: HealthAad): string {
    if (data.length < 29 || data[0] !== VERSION) throw new Error('Dado cifrado com formato desconhecido');
    const decipher = createDecipheriv('aes-256-gcm', this.key, data.subarray(1, 13));
    decipher.setAAD(aad(where));
    decipher.setAuthTag(data.subarray(13, 29));
    // Tag errada: `final()` lança. Não capturar aqui.
    return Buffer.concat([decipher.update(data.subarray(29)), decipher.final()]).toString('utf8');
  }
}
