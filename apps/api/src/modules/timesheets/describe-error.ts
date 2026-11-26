/**
 * O que pode ir para o log e para a fila quando a apuração automática falha: só
 * nome e código. A mensagem do Drizzle e do driver traz a consulta com os
 * parâmetros (CPF, por exemplo), e a fila grava a mensagem do erro no Valkey.
 */
export function describeError(err: unknown): { name: string; code: string | null } {
  const e = err as { name?: unknown; code?: unknown; cause?: { code?: unknown } } | null;
  const code = e?.code ?? e?.cause?.code;
  return {
    name: typeof e?.name === 'string' ? e.name : 'unknown',
    code: typeof code === 'string' ? code : null,
  };
}
