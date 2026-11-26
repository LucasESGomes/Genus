/** CPF no front: máscara e dígitos verificadores, só para a pessoa errar menos. A api decide. */

export const digitsOf = (v: string) => v.replace(/\D/g, '');

/** Máscara 000.000.000-00 enquanto digita. */
export function maskCpf(v: string): string {
  const d = digitsOf(v).slice(0, 11);
  const parts = [d.slice(0, 3), d.slice(3, 6), d.slice(6, 9)].filter(Boolean).join('.');
  return d.length > 9 ? `${parts}-${d.slice(9)}` : parts;
}

/** Dígitos verificadores (UX apenas). */
export function cpfLooksValid(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  const d = cpf.split('').map(Number);
  const check = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += (d[i] as number) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return check(9) === d[9] && check(10) === d[10];
}
