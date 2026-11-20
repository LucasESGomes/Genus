import { afterEach, describe, expect, it } from 'vitest';
import { closedPortUrl, createTestApp, type TestApp } from './support/harness';

// Os testes não tocam o banco nem a engine: o pool do pg só conecta na primeira query.
const NO_DB = 'postgres://ninguem:nada@127.0.0.1:1/arp';
let t: TestApp | undefined;

afterEach(async () => {
  await t?.close();
  t = undefined;
});

async function start(appEnv: 'dev' | 'homolog'): Promise<TestApp> {
  t = await createTestApp({ collectorUrl: NO_DB, engineUrl: await closedPortUrl(), env: { APP_ENV: appEnv } });
  return t;
}

describe('Swagger (/docs)', () => {
  it('dev, chamada local: UI e OpenAPI disponíveis, com a batida documentada como multipart', async () => {
    const { app } = await start('dev');
    const ui = await app.inject({ method: 'GET', url: '/docs/', remoteAddress: '127.0.0.1' });
    expect(ui.statusCode).toBe(200);
    expect(ui.headers['content-type']).toContain('text/html');

    const res = await app.inject({ method: 'GET', url: '/docs/json', remoteAddress: '127.0.0.1' });
    expect(res.statusCode).toBe(200);
    const doc = res.json();
    expect(doc.openapi).toBe('3.0.3');
    expect(Object.keys(doc.paths)).toEqual(expect.arrayContaining(['/coletor/batidas', '/health', '/health/ready']));

    const post = doc.paths['/coletor/batidas'].post;
    const multipart = post.requestBody.content['multipart/form-data'].schema;
    expect(multipart.required).toEqual(['image', 'deviceSequence', 'capturedAt']);
    expect(multipart.properties.image).toMatchObject({ type: 'string', format: 'binary' });
    expect(post.security).toEqual([{ serviceKey: [] }]);
    expect(Object.keys(post.responses)).toEqual(expect.arrayContaining(['200', '400', '401', '413', '500']));
    expect(doc.components.securitySchemes.serviceKey).toMatchObject({ type: 'apiKey', in: 'header', name: 'X-Service-Key' });
  });

  it('dev, chamada de outra máquina: 404 (a documentação não é pública)', async () => {
    const { app } = await start('dev');
    for (const url of ['/docs/', '/docs/json']) {
      const res = await app.inject({ method: 'GET', url, remoteAddress: '10.0.0.5' });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'Rota não encontrada', code: 'NOT_FOUND' });
    }
  });

  it('homolog: as rotas da documentação nem existem', async () => {
    const { app } = await start('homolog');
    for (const url of ['/docs/', '/docs/json']) {
      const res = await app.inject({ method: 'GET', url, remoteAddress: '127.0.0.1' });
      expect(res.statusCode).toBe(404);
    }
  });
});
