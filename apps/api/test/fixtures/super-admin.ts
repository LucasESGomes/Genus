/**
 * Auxiliares dos testes do painel do super_admin. Tudo fictício: empresas, e-mails
 * (domínio `.teste.dev`) e CNPJs gerados com dígitos verificadores válidos.
 */
import type { z } from 'zod';
import type { createTenantBody as createTenantBodySchema } from '../../src/modules/super-admin/contract';

export type CreateTenantBody = z.input<typeof createTenantBodySchema>;

const WEIGHTS_FIRST = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] as const;
const WEIGHTS_SECOND = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] as const;

/** Dígito verificador do CNPJ (módulo 11; resto menor que 2 vira 0). */
function cnpjCheckDigit(digits: readonly number[], weights: readonly number[]): number {
  const sum = digits.reduce((total, digit, i) => total + digit * (weights[i] ?? 0), 0);
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

/**
 * CNPJ de teste com dígitos verificadores válidos. `n` vira a base: 8 dígitos (raiz)
 * seguidos de `0001` (filial), e são calculados os dois dígitos finais.
 */
export function validCnpj(n: number): string {
  if (!Number.isInteger(n) || n < 0) throw new RangeError('validCnpj: n deve ser inteiro não negativo');
  const base = String(n % 100_000_000).padStart(8, '0') + '0001';
  const digits = [...base].map(Number);
  const first = cnpjCheckDigit(digits, WEIGHTS_FIRST);
  const second = cnpjCheckDigit([...digits, first], WEIGHTS_SECOND);
  return `${base}${first}${second}`;
}

/** Verificador de CNPJ (14 dígitos, dígitos verificadores conferidos). */
export function isValidCnpj(cnpj: string): boolean {
  if (!/^\d{14}$/.test(cnpj)) return false;
  const digits = [...cnpj.slice(0, 12)].map(Number);
  const first = cnpjCheckDigit(digits, WEIGHTS_FIRST);
  const second = cnpjCheckDigit([...digits, first], WEIGHTS_SECOND);
  return cnpj === `${digits.join('')}${first}${second}`;
}

/** CNPJ de 14 dígitos com verificador errado, para testar `CNPJ_INVALIDO`. */
export function invalidCnpj(): string {
  const valid = validCnpj(1);
  const wrongSecond = (Number(valid[13]) + 1) % 10;
  return `${valid.slice(0, 13)}${wrongSecond}`;
}

/** Corpo válido de `POST /tenants` (createTenantBody), com empresa fictícia numerada `n`. */
export function createTenantBody(overrides: Partial<CreateTenantBody> & { n?: number } = {}): CreateTenantBody {
  const { n = 1, ...rest } = overrides;
  const cnpj = validCnpj(n);
  const companyName = `Empresa Fictícia ${n} Ltda`;
  return {
    name: companyName,
    company: { legalName: companyName, cnpj },
    establishment: {
      name: `Estabelecimento ${n}`,
      registrationType: 'CNPJ',
      registration: cnpj,
      uf: 'SP',
      municipalityIbge: '3550308',
    },
    admin: { name: `Administrador ${n}`, email: `admin.${n}@cliente.teste.dev` },
    ...rest,
  };
}

/** Chaves que nunca podem sair em resposta (CPF, hash, cifrado, token, segredo, senha, embedding, DEK). */
export const SENSITIVE_KEY_PATTERN = /cpf|hash|cifrad|token|secret|senha|password|embedding|dek/i;

/**
 * Percorre objetos e arrays e devolve o caminho pontilhado (`data.0.token`) de cada
 * chave sensível. `allow` aceita nome de chave (`temporaryPassword`) ou caminho exato.
 */
export function findSensitiveKeys(json: unknown, allow: string[] = []): string[] {
  const found: string[] = [];
  const walk = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, path ? `${path}.${i}` : String(i)));
      return;
    }
    if (value === null || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      const childPath = path ? `${path}.${key}` : key;
      const isAllowed = allow.includes(key) || allow.includes(childPath);
      if (!isAllowed && SENSITIVE_KEY_PATTERN.test(key)) found.push(childPath);
      walk(child, childPath);
    }
  };
  walk(json, '');
  return found;
}
