/** bootstrapSuperAdmin: cria, é idempotente, atualiza o que mudou no .env e nunca promove outro papel. */
import { createLogger } from '@genus/shared';
import { hashPassword } from 'better-auth/crypto';
import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SuperAdminConfig } from '../src/config/env';
import { loadEnv } from '../src/config/env';
import { bootstrapSuperAdmin } from '../src/modules/super-admin/bootstrap';
import { BASE_URL, FixedClock, PASSWORD, PortalHarness } from './support/portal';

const h = new PortalHarness();
const lines: string[] = [];
const logger = createLogger({ level: 'debug', service: 'test', destination: new Writable({ write: (c: Buffer, _e, cb) => (lines.push(c.toString()), cb()) }) });
const clock = new FixedClock(new Date('2026-11-25T12:00:00Z'));
const run = (config: SuperAdminConfig | null) => bootstrapSuperAdmin({ db: h.handle.db, clock, logger, config, appEnv: 'dev' });
const signIn = (email: string, password: string) =>
  h.app.inject({ method: 'POST', url: '/auth/sign-in/email', headers: { origin: BASE_URL }, payload: { email, password } });
const auditCount = async () => Number((await h.one<{ c: string }>("SELECT count(*) c FROM rh.auditorias WHERE entidade = 'super_admin'")).c);

beforeAll(async () => h.start(), 240_000);
afterAll(async () => h.stop());

describe('bootstrapSuperAdmin', () => {
  it('sem configuração só avisa', async () => {
    expect(await run(null)).toBe('skipped');
    expect(lines.join('')).toContain('super_admin: SUPER_ADMIN_* ausentes; nenhum super_admin criado');
  });

  it('cria com senha em claro, entra, e a segunda execução não muda nem audita', async () => {
    const cfg: SuperAdminConfig = { email: 'root.plain@genus.teste.dev', name: 'Operação', password: { kind: 'plain', value: 'senha-super-admin-1' } };
    expect(await run(cfg)).toBe('created');
    const u = await h.one<{ papel: string; conta_id: string | null }>('SELECT papel, conta_id FROM rh.usuarios WHERE email = $1', [cfg.email]);
    expect(u).toEqual({ papel: 'super_admin', conta_id: null });
    expect((await signIn(cfg.email, 'senha-super-admin-1')).statusCode).toBe(200);
    expect(await auditCount()).toBe(1);
    const audit = await h.one<{ conta_id: string | null; usuario_id: string | null; acao: string }>("SELECT conta_id, usuario_id, acao FROM rh.auditorias WHERE entidade = 'super_admin'");
    expect(audit).toEqual({ conta_id: null, usuario_id: null, acao: 'criacao' });

    const hashBefore = (await h.one<{ senha_hash: string }>('SELECT c.senha_hash FROM rh.credenciais_login c JOIN rh.usuarios u ON u.id = c.usuario_id WHERE u.email = $1', [cfg.email])).senha_hash;
    expect(await run(cfg)).toBe('unchanged');
    expect(await auditCount()).toBe(1);
    const hashAfter = (await h.one<{ senha_hash: string }>('SELECT c.senha_hash FROM rh.credenciais_login c JOIN rh.usuarios u ON u.id = c.usuario_id WHERE u.email = $1', [cfg.email])).senha_hash;
    expect(hashAfter).toBe(hashBefore);

    // nome e senha trocados no .env
    expect(await run({ ...cfg, name: 'Outro Nome', password: { kind: 'plain', value: 'senha-super-admin-2' } })).toBe('updated');
    expect((await signIn(cfg.email, 'senha-super-admin-1')).statusCode).toBe(401);
    expect((await signIn(cfg.email, 'senha-super-admin-2')).statusCode).toBe(200);
    expect((await h.one<{ nome: string }>('SELECT nome FROM rh.usuarios WHERE email = $1', [cfg.email])).nome).toBe('Outro Nome');
    expect(await auditCount()).toBe(2);
    const last = await h.one<{ acao: string; dados_depois: Record<string, unknown> }>("SELECT acao, dados_depois FROM rh.auditorias WHERE entidade = 'super_admin' ORDER BY id DESC LIMIT 1");
    expect(last.acao).toBe('alteracao');
    expect(JSON.stringify(last.dados_depois)).not.toContain('senha-super-admin');
  });

  it('cria com hash pronto, atualiza quando o hash muda e nunca loga senha nem hash', async () => {
    const email = 'root.hash@genus.teste.dev';
    const hash1 = await hashPassword('senha-por-hash-001');
    const hash2 = await hashPassword('senha-por-hash-002');
    const cfg: SuperAdminConfig = { email, name: 'Root Hash', password: { kind: 'hash', value: hash1 } };
    expect(await run(cfg)).toBe('created');
    expect((await signIn(email, 'senha-por-hash-001')).statusCode).toBe(200);
    expect(await run(cfg)).toBe('unchanged');
    expect(await run({ ...cfg, password: { kind: 'hash', value: hash2 } })).toBe('updated');
    expect((await signIn(email, 'senha-por-hash-002')).statusCode).toBe(200);
    const all = lines.join('\n');
    for (const secret of [hash1, hash2, 'senha-por-hash-001', 'senha-por-hash-002', 'senha-super-admin-1', 'senha-super-admin-2', email]) {
      expect(all.includes(secret)).toBe(false);
    }
    expect(JSON.stringify((await h.client.query("SELECT dados_antes, dados_depois FROM rh.auditorias WHERE entidade = 'super_admin'")).rows)).not.toContain(hash2);
  });

  it('e-mail de outro papel: erro e nada é alterado', async () => {
    const org = await h.createOrg();
    const rh = await h.users.createUser({ tenantId: org.tenantId, email: 'rh.colide@genus.teste.dev', name: 'RH', role: 'rh', password: PASSWORD });
    const before = await auditCount();
    const cfg: SuperAdminConfig = { email: rh.email, name: 'Promovido', password: { kind: 'plain', value: 'senha-super-admin-9' } };
    expect(await run(cfg)).toBe('refused');
    expect(lines.join('')).toContain('super_admin: e-mail do .env pertence a outro papel; nada foi alterado');
    expect(await h.one('SELECT papel, nome FROM rh.usuarios WHERE id = $1', [rh.id])).toEqual({ papel: 'rh', nome: 'RH' });
    expect(await auditCount()).toBe(before);
    expect((await signIn(rh.email, PASSWORD)).statusCode).toBe(200);
  });
});

describe('loadEnv SUPER_ADMIN_*', () => {
  const base = {
    APP_ENV: 'dev', RH_DATABASE_URL: 'postgres://x', BETTER_AUTH_SECRET: 'x'.repeat(32), ARP_READER_DATABASE_URL: 'postgres://y', PIN_PEPPER: '1'.repeat(64),
  };
  it('tudo ou nada, hash vence a senha, sem valor nas mensagens', async () => {
    const hash = await hashPassword('senha-qualquer-123');
    expect(loadEnv(base).superAdmin).toBeNull();
    const full = { ...base, SUPER_ADMIN_EMAIL: 'a@b.com', SUPER_ADMIN_NAME: 'Fulano', SUPER_ADMIN_PASSWORD: 'senha-de-teste-123', SUPER_ADMIN_PASSWORD_HASH: hash };
    expect(loadEnv(full).superAdmin).toEqual({ email: 'a@b.com', name: 'Fulano', password: { kind: 'hash', value: hash } });
    expect(loadEnv({ ...full, SUPER_ADMIN_PASSWORD_HASH: undefined }).superAdmin?.password.kind).toBe('plain');
    expect(() => loadEnv({ ...base, SUPER_ADMIN_EMAIL: 'a@b.com' })).toThrow(/SUPER_ADMIN_EMAIL/);
    let message = '';
    try {
      loadEnv({ ...full, SUPER_ADMIN_PASSWORD_HASH: 'lixo-secreto', SUPER_ADMIN_PASSWORD: 'curta' });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('SUPER_ADMIN_PASSWORD_HASH');
    expect(message).not.toContain('lixo-secreto');
    expect(() => loadEnv({ ...base, MASTER_KEY: 'zz' })).toThrow(/MASTER_KEY/);
  });
});
