/** BIGINT do `pg` chega como string; só aceitamos o que cabe em Number sem perda. */
export function toSafeInt(value: unknown, field: string): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isSafeInteger(n)) {
    throw new Error(`${field}: valor fora do intervalo inteiro seguro`);
  }
  return n;
}
