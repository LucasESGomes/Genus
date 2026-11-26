/**
 * Completa o `.env.prod` da raiz (fora do Git) com o que o docker-compose.easypanel.yml exige.
 * O conteúdo é colado no ambiente do serviço no Easypanel.
 *
 *   corepack pnpm --filter @genus/api exec tsx scripts/gen-prod-env.ts --url https://portal.exemplo.com --email voce@exemplo.com
 *
 * Só PREENCHE o que falta: o que já está no arquivo é mantido. Se o Genus já roda em produção, cole
 * antes o ambiente atual no arquivo: gerar de novo as senhas, a MASTER_KEY ou o PIN_PEPPER torna o
 * banco e a biometria ilegíveis. Instalação nova, sem arquivo: passe --new.
 *
 * Produção que já existe e só ganha o super_admin: `--super-admin --email voce@exemplo.com` grava as três
 * SUPER_ADMIN_* em `.env.prod.super-admin`, para ACRESCENTAR ao ambiente atual sem tocar no resto.
 *
 * Nenhum valor é impresso: só os nomes das variáveis acrescentadas.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { hashPassword } from 'better-auth/crypto';

const { values } = parseArgs({
  options: { url: { type: 'string' }, email: { type: 'string' }, name: { type: 'string' }, new: { type: 'boolean' }, 'super-admin': { type: 'boolean' } },
});

const onlySuperAdmin = values['super-admin'] === true;
const root = resolve(import.meta.dirname, '../../..');
const fileName = onlySuperAdmin ? '.env.prod.super-admin' : '.env.prod';
const target = resolve(root, fileName);
const fail = (message: string): never => {
  process.stderr.write(`Erro: ${message}\n`);
  process.exit(1);
};

if (!onlySuperAdmin && !existsSync(target) && !values.new) {
  fail('não há .env.prod. Já existe produção? Cole o ambiente atual do Easypanel em .env.prod. Instalação nova: rode com --new.');
}

const current = existsSync(target) ? readFileSync(target, 'utf8') : '';
const defined = new Set(
  current
    .split(/\r?\n/)
    .map((line) => /^\s*([A-Z_0-9]+)\s*=\s*(.*)$/.exec(line))
    .filter((m): m is RegExpExecArray => m !== null && m[2] !== '' && !m[2]!.includes('TROQUE'))
    .map((m) => m[1]!),
);

const compose = readFileSync(resolve(root, 'docker-compose.easypanel.yml'), 'utf8');
const required = [...new Set([...compose.matchAll(/\$\{([A-Z_0-9]+):\?/g)].map((m) => m[1]!))].filter(
  (key) => !onlySuperAdmin || key.startsWith('SUPER_ADMIN_'),
);

const hex = (bytes: number) => randomBytes(bytes).toString('hex');
const added: string[] = [];
const lines: string[] = [];

for (const key of required) {
  if (defined.has(key)) continue;
  let value: string;
  if (key === 'POSTGRES_USER') value = 'genus_admin';
  else if (key.endsWith('_PASSWORD')) value = hex(16);
  else if (['MASTER_KEY', 'BETTER_AUTH_SECRET', 'PIN_PEPPER', 'CERTIFICATE_DATA_KEY'].includes(key)) value = hex(32);
  else if (['ENGINE_API_KEY', 'COLLECTOR_SERVICE_KEYS'].includes(key)) value = hex(24);
  else if (key === 'PORTAL_PUBLIC_URL') {
    const url = values.url ?? fail('falta PORTAL_PUBLIC_URL: passe --url https://...');
    if (!url.startsWith('https://')) fail('PORTAL_PUBLIC_URL precisa ser https (a câmera do totem e o cookie de sessão exigem)');
    value = new URL(url).origin;
  } else if (key === 'SUPER_ADMIN_EMAIL') value = values.email ?? fail('falta SUPER_ADMIN_EMAIL: passe --email');
  else if (key === 'SUPER_ADMIN_NAME') value = values.name ?? 'Operação Genus';
  else if (key === 'SUPER_ADMIN_PASSWORD_HASH') {
    const password = randomBytes(15).toString('base64url');
    value = await hashPassword(password);
    lines.push(`# Senha inicial do super_admin (guarde num gerenciador de senhas e apague esta linha): ${password}`);
  } else value = fail(`variável obrigatória sem gerador: ${key}`);
  lines.push(`${key}=${value}`);
  added.push(key);
}

if (added.length > 0) {
  // Linhas antigas com a mesma chave (vazias ou com TROQUE_) saem, para não sobrescrever as novas.
  const kept = current
    .split(/\r?\n/)
    .filter((line) => !added.includes(/^\s*([A-Z_0-9]+)\s*=/.exec(line)?.[1] ?? ''))
    .join('\n')
    .trimEnd();
  writeFileSync(target, `${kept ? `${kept}\n` : ''}${lines.join('\n')}\n`, { mode: 0o600 });
}
process.stdout.write(added.length ? `Acrescentadas em ${fileName}: ${added.join(', ')}\n` : `Nada a acrescentar: ${fileName} já tem todas as obrigatórias.\n`);
