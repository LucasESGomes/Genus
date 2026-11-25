/**
 * Dígitos verificadores do CNPJ (módulo 11, pesos 5..2,9..2 e 6..2,9..2). Função pura: só confere
 * os dígitos, não consulta a Receita. CNPJ com todos os dígitos iguais é recusado.
 */
const WEIGHTS_12 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] as const;
const WEIGHTS_13 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] as const;

function checkDigit(digits: readonly number[], weights: readonly number[]): number {
  const sum = digits.reduce((acc, d, i) => acc + d * weights[i]!, 0);
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

/** `cnpj`: 14 dígitos, sem pontuação. */
export function isValidCnpj(cnpj: string): boolean {
  if (!/^\d{14}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj)) return false;
  const digits = cnpj.split('').map(Number);
  return checkDigit(digits.slice(0, 12), WEIGHTS_12) === digits[12] && checkDigit(digits.slice(0, 13), WEIGHTS_13) === digits[13];
}
