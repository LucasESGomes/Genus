/**
 * `jobId` determinísticos: publicar a mesma batida duas vezes vira no-op no
 * BullMQ. Só `-` como separador: o BullMQ 6.7.8 recusa `:` em jobId
 * personalizado (aceita só o formato legado de 3 partes). A garantia real
 * contra duplicata continua sendo a UNIQUE do banco.
 */
import { POST_PUNCH_EVENTS } from './constants.js';

function assertPositiveSafeInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} deve ser um inteiro positivo seguro`);
  }
}

/** `punches`: `<aparelhoId>-<sequencia>`. */
export function punchJobId(deviceId: number, deviceSequence: number): string {
  assertPositiveSafeInteger('deviceId', deviceId);
  assertPositiveSafeInteger('deviceSequence', deviceSequence);
  return `${deviceId}-${deviceSequence}`;
}

/** Inverso de `punchJobId`. `null` se o texto não for um jobId de `punches` válido. */
export function parsePunchJobId(jobId: string): { deviceId: number; deviceSequence: number } | null {
  const match = /^([1-9]\d{0,15})-([1-9]\d{0,15})$/.exec(jobId);
  if (!match) return null;
  const deviceId = Number(match[1]);
  const deviceSequence = Number(match[2]);
  if (!Number.isSafeInteger(deviceId) || !Number.isSafeInteger(deviceSequence)) return null;
  return { deviceId, deviceSequence };
}

/** `post-punch`: `<evento>-<estabelecimentoId>-<nsr>`. */
export function postPunchJobId(event: string, establishmentId: number, nsr: number): string {
  if (!(POST_PUNCH_EVENTS as readonly string[]).includes(event)) {
    throw new RangeError('event desconhecido');
  }
  assertPositiveSafeInteger('establishmentId', establishmentId);
  assertPositiveSafeInteger('nsr', nsr);
  return `${event}-${establishmentId}-${nsr}`;
}
