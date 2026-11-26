/**
 * Imagens de tentativa de fraude (`liveness_failed`). Dado biométrico: sempre
 * cifrado (AES-256-GCM, chave derivada da MASTER_KEY por HKDF), nunca em log.
 *
 * Disposição: <dir>/<tenantId>/<AAAA-MM-DD de capturedAt, UTC>/<deviceId>-<deviceSequence>.jpg.enc
 * (IV 12 bytes | tag 16 bytes | cifrado) + .json de metadados. O dia vem de
 * `capturedAt` para o reenvio cair no mesmo arquivo.
 *
 * Retenção: nada é apagado automaticamente. Prazo de guarda [A CONFIRMAR].
 */
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { access, mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseMasterKey } from '@genus/shared';

const HKDF_INFO = 'genus:fraud-frames:v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface FraudFrame {
  tenantId: number;
  establishmentId: number;
  deviceId: number;
  deviceSequence: number;
  capturedAt: Date;
  receivedAt: Date;
  traceId: string;
  livenessScore: number | null;
  image: Buffer;
  imageMime: string;
}

export interface FraudFrameMetadata {
  tenantId: number;
  establishmentId: number;
  deviceId: number;
  deviceSequence: number;
  capturedAt: string;
  receivedAt: string;
  traceId: string;
  livenessScore?: number;
  mime: string;
  /** SHA-256 (hex) da imagem em claro. */
  sha256: string;
  sizeBytes: number;
}

export interface FraudFrameStore {
  /** Idempotente por (conta, dia, aparelho, sequência). */
  save(frame: FraudFrame): Promise<void>;
}

const deriveKey = (masterKeyHex: string): Buffer =>
  Buffer.from(hkdfSync('sha256', parseMasterKey(masterKeyHex), Buffer.alloc(0), HKDF_INFO, 32));

export function decryptFraudFrame(file: Buffer, masterKeyHex: string): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(masterKeyHex), file.subarray(0, IV_BYTES), {
    authTagLength: TAG_BYTES,
  });
  decipher.setAuthTag(file.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  return Buffer.concat([decipher.update(file.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]);
}

export class FsFraudFrameStore implements FraudFrameStore {
  private readonly key: Buffer;

  constructor(
    private readonly dir: string,
    masterKeyHex: string,
  ) {
    this.key = deriveKey(masterKeyHex);
  }

  async save(frame: FraudFrame): Promise<void> {
    const folder = path.join(this.dir, String(frame.tenantId), frame.capturedAt.toISOString().slice(0, 10));
    const base = path.join(folder, `${frame.deviceId}-${frame.deviceSequence}`);
    // O .json é gravado por último: se existe, o par está completo e o reenvio não regrava.
    if (await access(`${base}.json`).then(() => true, () => false)) return;

    await mkdir(folder, { recursive: true, mode: 0o700 });
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv, { authTagLength: TAG_BYTES });
    const encrypted = Buffer.concat([cipher.update(frame.image), cipher.final()]);
    await writeAtomic(`${base}.jpg.enc`, Buffer.concat([iv, cipher.getAuthTag(), encrypted]));

    const metadata: FraudFrameMetadata = {
      tenantId: frame.tenantId,
      establishmentId: frame.establishmentId,
      deviceId: frame.deviceId,
      deviceSequence: frame.deviceSequence,
      capturedAt: frame.capturedAt.toISOString(),
      receivedAt: frame.receivedAt.toISOString(),
      traceId: frame.traceId,
      ...(frame.livenessScore === null ? {} : { livenessScore: frame.livenessScore }),
      mime: frame.imageMime,
      sha256: createHash('sha256').update(frame.image).digest('hex'),
      sizeBytes: frame.image.length,
    };
    await writeAtomic(`${base}.json`, `${JSON.stringify(metadata, null, 2)}\n`);
  }
}

/** Escreve num temporário e renomeia: queda no meio não deixa arquivo pela metade. */
async function writeAtomic(file: string, data: Buffer | string): Promise<void> {
  const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tmp, data, { mode: 0o600 });
  await rename(tmp, file);
}
