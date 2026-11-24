/**
 * PIN do colaborador para o modo alternativo (sem reconhecimento facial).
 * Todo colaborador tem um (`colaboradores.pin_hash NOT NULL`).
 *
 * O colaborador se identifica por matrícula ou CPF e o PIN só confirma a
 * pessoa: por isso o PIN não precisa ser único e pode ter sal aleatório.
 *
 * Defesas, porque um PIN de 4 a 6 dígitos tem no máximo 1 milhão de valores:
 * - **Pepper:** antes do scrypt, o PIN passa por HMAC-SHA256 com uma chave
 *   secreta do servidor, que não fica no banco nem no aparelho. Quem vazar o
 *   banco (ou roubar um aparelho) sem a chave não consegue testar os PINs.
 * - **scrypt com sal:** mesmo com a chave, cada tentativa custa caro.
 * - **PIN fraco recusado:** todos os dígitos iguais ou em sequência.
 * - **Sorteio** com `crypto.randomInt` quando o RH gera o PIN.
 *
 * Formato em `colaboradores.pin_hash`:
 *
 *   scrypt$<versão do pepper>$<N>$<r>$<p>$<sal base64url>$<hash base64url>
 *
 * A versão do pepper e os parâmetros ficam no próprio hash: dá para trocar a
 * chave ou endurecer o custo sem invalidar os PINs já definidos.
 * Nunca logue o PIN, o hash nem o pepper.
 */
import { createHmac, randomBytes, randomInt, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { RhDomainError } from '../rules-common/rules/errors';

export interface PinHashParams {
  /** Custo de CPU e memória; potência de 2. */
  N: number;
  r: number;
  p: number;
}

/** Chave secreta do servidor (pepper), com versão para rotação. */
export interface PinPepper {
  version: number;
  /** Pelo menos 32 bytes aleatórios. */
  key: Buffer;
}

export const DEFAULT_PIN_HASH_PARAMS: Readonly<PinHashParams> = { N: 2 ** 15, r: 8, p: 1 };
export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 6;

const PIN_RE = /^[0-9]{4,6}$/;
const SALT_BYTES = 16;
const KEY_BYTES = 32;
const PEPPER_MIN_BYTES = 32;
const B64URL_RE = /^[A-Za-z0-9_-]+$/;
const INT_RE = /^[0-9]{1,8}$/;

// Limites para um hash lido do banco: um parâmetro adulterado não pode
// travar o processo (N enorme) nem enfraquecer a conferência (N pequeno).
const MIN_N = 2 ** 14;
const MAX_N = 2 ** 20;
const MAX_R = 32;
const MAX_P = 16;

function scryptAsync(password: Buffer, salt: Buffer, params: PinHashParams): Promise<Buffer> {
  const options: ScryptOptions = {
    N: params.N,
    r: params.r,
    p: params.p,
    // o padrão do Node (32 MiB) é exatamente o que N=2^15, r=8 usa; folga para não falhar
    maxmem: 256 * params.N * params.r + 1024 * 1024,
  };
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_BYTES, options, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

function assertParams(params: PinHashParams): void {
  const { N, r, p } = params;
  const ok =
    Number.isInteger(N) && N >= MIN_N && N <= MAX_N && (N & (N - 1)) === 0 &&
    Number.isInteger(r) && r >= 1 && r <= MAX_R &&
    Number.isInteger(p) && p >= 1 && p <= MAX_P;
  if (!ok) throw new RhDomainError('PIN_HASH_INVALIDO', 'Parâmetros do hash do PIN fora do permitido.');
}

function assertPepper(pepper: PinPepper): void {
  if (!Number.isInteger(pepper.version) || pepper.version < 1 || pepper.key.length < PEPPER_MIN_BYTES) {
    throw new RhDomainError('PIN_PEPPER_INVALIDO', `O pepper do PIN precisa de versão >= 1 e ao menos ${PEPPER_MIN_BYTES} bytes.`);
  }
}

function peppered(pin: string, pepper: PinPepper): Buffer {
  return createHmac('sha256', pepper.key).update(pin, 'utf8').digest();
}

/** Só dígitos, de 4 a 6. */
export function isValidPinFormat(pin: string): boolean {
  return PIN_RE.test(pin);
}

/** Todos os dígitos iguais (0000) ou em sequência crescente ou decrescente (1234, 987654). */
export function isWeakPin(pin: string): boolean {
  const d = [...pin].map(Number);
  const steps = d.slice(1).map((x, i) => x - (d[i] as number));
  return steps.every((s) => s === 0) || steps.every((s) => s === 1) || steps.every((s) => s === -1);
}

/**
 * Sorteia um PIN forte (o RH entrega ao colaborador na admissão).
 * `rng` é injetável só para testes; o padrão é `crypto.randomInt`.
 */
export function generatePin(length = PIN_MAX_LENGTH, rng: (max: number) => number = randomInt): string {
  if (!Number.isInteger(length) || length < PIN_MIN_LENGTH || length > PIN_MAX_LENGTH) {
    throw new RhDomainError('PIN_FORMATO_INVALIDO', `O PIN deve ter de ${PIN_MIN_LENGTH} a ${PIN_MAX_LENGTH} dígitos.`);
  }
  for (let attempt = 0; attempt < 100; attempt++) {
    const pin = Array.from({ length }, () => String(rng(10))).join('');
    if (isValidPinFormat(pin) && !isWeakPin(pin)) return pin;
  }
  throw new Error('generatePin: gerador de números não produziu um PIN válido');
}

export interface HashPinOptions {
  params?: PinHashParams;
  /** Só para testes; em produção o sal é sempre aleatório. */
  salt?: Buffer;
}

/** Gera o hash para gravar em `colaboradores.pin_hash`. Recusa PIN inválido ou fraco. */
export async function hashPin(pin: string, pepper: PinPepper, options: HashPinOptions = {}): Promise<string> {
  if (!isValidPinFormat(pin)) {
    throw new RhDomainError('PIN_FORMATO_INVALIDO', `O PIN deve ter de ${PIN_MIN_LENGTH} a ${PIN_MAX_LENGTH} dígitos.`);
  }
  if (isWeakPin(pin)) {
    throw new RhDomainError('PIN_FRACO', 'O PIN não pode ter todos os dígitos iguais nem em sequência.');
  }
  assertPepper(pepper);
  const params = options.params ?? DEFAULT_PIN_HASH_PARAMS;
  assertParams(params);
  const salt = options.salt ?? randomBytes(SALT_BYTES);
  if (salt.length < SALT_BYTES) {
    throw new RhDomainError('PIN_HASH_INVALIDO', `O sal do PIN deve ter ao menos ${SALT_BYTES} bytes.`);
  }
  const key = await scryptAsync(peppered(pin, pepper), salt, params);
  return ['scrypt', pepper.version, params.N, params.r, params.p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

interface ParsedPinHash {
  pepperVersion: number;
  params: PinHashParams;
  salt: Buffer;
  key: Buffer;
}

function parsePinHash(stored: string): ParsedPinHash {
  const invalid = () => new RhDomainError('PIN_HASH_INVALIDO', 'Hash do PIN em formato inválido.');
  const parts = stored.split('$');
  if (parts.length !== 7 || parts[0] !== 'scrypt') throw invalid();
  const [, v, n, r, p, saltB64, keyB64] = parts as [string, string, string, string, string, string, string];
  if (![v, n, r, p].every((x) => INT_RE.test(x))) throw invalid();
  if (!B64URL_RE.test(saltB64) || !B64URL_RE.test(keyB64)) throw invalid();
  const params = { N: Number(n), r: Number(r), p: Number(p) };
  assertParams(params);
  const salt = Buffer.from(saltB64, 'base64url');
  const key = Buffer.from(keyB64, 'base64url');
  if (salt.length < SALT_BYTES || key.length !== KEY_BYTES) throw invalid();
  return { pepperVersion: Number(v), params, salt, key };
}

/**
 * Confere o PIN com o hash guardado, em tempo constante. `peppers` traz a
 * chave atual e as anteriores ainda aceitas (rotação).
 * - PIN em formato errado só não confere (false).
 * - Hash malformado é erro (PIN_HASH_INVALIDO): dado corrompido ou adulterado.
 * - Versão de pepper desconhecida é erro (PIN_PEPPER_INVALIDO): configuração.
 */
export async function verifyPin(pin: string, storedHash: string, peppers: readonly PinPepper[]): Promise<boolean> {
  const parsed = parsePinHash(storedHash);
  const pepper = peppers.find((pp) => pp.version === parsed.pepperVersion);
  if (!pepper) {
    throw new RhDomainError('PIN_PEPPER_INVALIDO', 'Versão do pepper do PIN não configurada.', { version: parsed.pepperVersion });
  }
  assertPepper(pepper);
  const formatOk = isValidPinFormat(pin);
  // Mesmo com o PIN em formato errado, calcula o hash: o tempo de resposta não revela o motivo.
  const candidate = await scryptAsync(peppered(formatOk ? pin : '', pepper), parsed.salt, parsed.params);
  return timingSafeEqual(candidate, parsed.key) && formatOk;
}

/** O hash precisa ser refeito (pepper ou custo antigos)? Útil no próximo acerto do PIN. */
export function pinHashNeedsRehash(storedHash: string, current: PinPepper, params: PinHashParams = DEFAULT_PIN_HASH_PARAMS): boolean {
  const parsed = parsePinHash(storedHash);
  return (
    parsed.pepperVersion !== current.version ||
    parsed.params.N !== params.N ||
    parsed.params.r !== params.r ||
    parsed.params.p !== params.p
  );
}
