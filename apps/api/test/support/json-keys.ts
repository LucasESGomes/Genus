import { expect } from 'vitest';

/** Todas as chaves de um JSON, em qualquer profundidade. */
export function allKeys(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const v of value) allKeys(v, out);
  else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      allKeys(v, out);
    }
  }
  return out;
}

const FORBIDDEN_KEY = /cpf|collaborator|colaborador|emailhash|email_hash|token|password|senha|secret|embedding/i;

/** A resposta do painel do super_admin nunca leva CPF, colaborador, hash de e-mail, token nem segredo. */
export function expectNoForbiddenKeys(body: unknown): void {
  const bad = [...allKeys(body)].filter((k) => FORBIDDEN_KEY.test(k));
  expect(bad, `chaves proibidas: ${bad.join(', ')}`).toEqual([]);
}
