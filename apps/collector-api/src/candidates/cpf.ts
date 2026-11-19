/**
 * CPF fictício para desenvolvimento e testes. Dígitos verificadores reais
 * (módulo 11), geração determinística a partir de um índice.
 */

function checkDigit(digits: number[]): number {
  const weightStart = digits.length + 1;
  const sum = digits.reduce((acc, d, i) => acc + d * (weightStart - i), 0);
  const rest = (sum * 10) % 11;
  return rest === 10 ? 0 : rest;
}

/** Valida um CPF (só dígitos, 11 posições, sem sequência repetida). */
export function isValidCpf(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf)) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;
  const d = cpf.split('').map(Number);
  return checkDigit(d.slice(0, 9)) === d[9] && checkDigit(d.slice(0, 10)) === d[10];
}

/**
 * CPF válido e determinístico para o índice. A multiplicação por um primo
 * coprimo de 10^9 torna o mapa índice → base injetivo (índices distintos dão
 * CPFs distintos para índices menores que 10^9).
 */
export function generateFakeCpf(index: number): string {
  if (!Number.isInteger(index) || index < 0) throw new Error('índice de CPF deve ser inteiro >= 0');
  let base = (index * 7919 + 123_456_789) % 1_000_000_000;
  let digits = String(base).padStart(9, '0');
  if (/^(\d)\1{8}$/.test(digits)) {
    base = (base + 1) % 1_000_000_000;
    digits = String(base).padStart(9, '0');
  }
  const d = digits.split('').map(Number);
  const d1 = checkDigit(d);
  const d2 = checkDigit([...d, d1]);
  return `${digits}${d1}${d2}`;
}
