import { describe, expect, it } from 'vitest';
import { createApiClient } from './client';
import { ApiError, GENERIC_SERVER_MESSAGE, NETWORK_MESSAGE } from './errors';

const reply = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function failure(status: number, body: unknown) {
  const c = createApiClient(reply(status, body));
  return c.get('/portal/x').then(() => { throw new Error('devia falhar'); }, (e: ApiError) => e);
}

describe('cliente de api', () => {
  it('200 devolve o corpo', async () => {
    await expect(createApiClient(reply(200, { data: { ok: 1 } })).get('/me')).resolves.toEqual({ data: { ok: 1 } });
  });
  it('400 traz os erros de campo', async () => {
    const e = await failure(400, { error: 'Dados inválidos', code: 'VALIDATION_ERROR', details: [{ path: 'startDate', message: 'Obrigatório' }] });
    expect(e.kind).toBe('validation');
    expect(e.fields).toEqual([{ path: 'startDate', message: 'Obrigatório' }]);
  });
  it('403 vira sem permissão', async () => {
    expect((await failure(403, { error: 'Sem permissão', code: 'FORBIDDEN' })).kind).toBe('forbidden');
  });
  it('409 mantém o código e a mensagem de domínio', async () => {
    const e = await failure(409, { error: 'O setor ficaria desfalcado nesse intervalo', code: 'FERIAS_SETOR_DESFALCADO' });
    expect(e.kind).toBe('conflict');
    expect(e.code).toBe('FERIAS_SETOR_DESFALCADO');
    expect(e.message).toBe('O setor ficaria desfalcado nesse intervalo');
  });
  it('500 nunca repassa o texto do servidor', async () => {
    const e = await failure(500, { error: 'at Object.<anonymous> (server.ts:10) CPF 12345678909', code: 'INTERNAL_ERROR' });
    expect(e.kind).toBe('server');
    expect(e.message).toBe(GENERIC_SERVER_MESSAGE);
  });
  it('falha de rede vira erro de conexão', async () => {
    const c = createApiClient(async () => { throw new TypeError('fetch failed'); });
    await expect(c.get('/me')).rejects.toMatchObject({ kind: 'network', message: NETWORK_MESSAGE });
  });
});
