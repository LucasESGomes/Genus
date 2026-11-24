/** CPF: só dígitos, 11 posições e dígitos verificadores válidos (04 §G1). Função pura. */

export function normalizeCpf(input: string): string {
  return input.replace(/[.\-\s]/g, '');
}

export function isValidCpf(cpf: string): boolean {
  if (!/^[0-9]{11}$/.test(cpf)) return false;
  // 000.000.000-00, 111.111.111-11...: passam no cálculo, mas não são CPF
  if (/^(\d)\1{10}$/.test(cpf)) return false;
  const digits = cpf.split('').map(Number);
  const check = (len: number): number => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += (digits[i] as number) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return check(9) === digits[9] && check(10) === digits[10];
}
