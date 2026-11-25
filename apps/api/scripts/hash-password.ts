/**
 * Imprime o hash scrypt do Better Auth de uma senha, para SUPER_ADMIN_PASSWORD_HASH (a senha em claro
 * não precisa ficar no ambiente). Lê de NEW_PASSWORD ou, sem ela, da entrada padrão:
 *
 *   NEW_PASSWORD='...' pnpm rh:hash-password
 *   echo -n 'senha' | pnpm rh:hash-password
 *
 * Só o hash vai para a saída; a senha nunca é ecoada.
 */
import { hashPassword } from 'better-auth/crypto';
import { MIN_PASSWORD_LENGTH } from '../src/modules/auth/auth';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
}

const password = process.env.NEW_PASSWORD ?? (process.stdin.isTTY ? '' : await readStdin());
if (password.length < MIN_PASSWORD_LENGTH || password.length > 128) {
  process.stderr.write(`Informe a senha em NEW_PASSWORD ou pela entrada padrão (${MIN_PASSWORD_LENGTH} a 128 caracteres).\n`);
  process.exit(1);
}
process.stdout.write(`${await hashPassword(password)}\n`);
