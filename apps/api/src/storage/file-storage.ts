/**
 * Armazenamento de arquivos (atestados). A rota só conhece a interface: hoje o
 * adaptador grava em disco (volume Docker); o S3 com SSE (security-lgpd §2)
 * entra depois como outro adaptador, sem mudar as rotas.
 *
 * Chave do objeto, nunca URL: `contas/{conta}/atestados/{sha256}` (security-lgpd §3).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface FileStorage {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
}

const KEY_RE = /^[a-z0-9_-]+(\/[a-z0-9_.-]+)+$/;

export class LocalDiskStorage implements FileStorage {
  private readonly root: string;

  constructor(rootDir: string) {
    this.root = path.resolve(rootDir);
  }

  private resolve(key: string): string {
    // Chave montada no servidor; mesmo assim, nada de `..` nem caminho absoluto.
    if (!KEY_RE.test(key) || key.includes('..')) throw new Error('Chave de arquivo inválida');
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error('Chave de arquivo inválida');
    return full;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true, mode: 0o700 });
    // wx: nunca sobrescreve (a chave é o hash do conteúdo; o mesmo arquivo dá a mesma chave)
    await writeFile(full, data, { flag: 'wx', mode: 0o600 }).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'EEXIST') throw err;
    });
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.resolve(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }
}

/** Para os testes: tudo em memória. */
export class MemoryStorage implements FileStorage {
  readonly files = new Map<string, Buffer>();
  async put(key: string, data: Buffer): Promise<void> {
    if (!this.files.has(key)) this.files.set(key, Buffer.from(data));
  }
  async get(key: string): Promise<Buffer | null> {
    return this.files.get(key) ?? null;
  }
}
