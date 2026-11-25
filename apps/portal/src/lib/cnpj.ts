/** CNPJ: só dígitos, validação do dígito verificador e máscara de exibição. */

export const onlyDigits = (v: string) => v.replace(/\D/g, '');

function check(base: string): string {
  const weights = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const sum = [...base].reduce((acc, d, i) => acc + Number(d) * (weights[i] ?? 0), 0);
  const r = sum % 11;
  return String(r < 2 ? 0 : 11 - r);
}

/** 14 dígitos, não todos iguais, com os dois dígitos verificadores corretos. */
export function isValidCnpj(value: string): boolean {
  const d = onlyDigits(value);
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const first = check(d.slice(0, 12));
  return first === d[12] && check(d.slice(0, 12) + first) === d[13];
}

export function formatCnpj(value: string): string {
  const d = onlyDigits(value);
  return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : value;
}
