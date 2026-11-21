import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const DEFAULT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");
// Chave arbitrária e fixa do advisory lock das migrations do arp.
const LOCK_KEY = 7_120_001;

/**
 * sha256 do conteúdo com fim de linha normalizado (CRLF -> LF). Assim o mesmo arquivo tem o mesmo
 * checksum em Windows (autocrlf) e em Linux; sem isso, um checkout diferente acusa "alterada".
 */
export function checksum(sql: string): string {
  return createHash("sha256").update(sql.replace(/\r\n/g, "\n")).digest("hex");
}

export interface MigrateResult {
  applied: string[];
  skipped: string[];
}

/**
 * Aplica os arquivos `.sql` de `migrationsDir` em ordem de nome, cada um numa
 * transação. Pula os já aplicados e FALHA se o sha256 de um aplicado mudou
 * (nunca edite migration já aplicada). Seguro contra execução concorrente.
 */
export async function migrate(
  connectionString: string,
  migrationsDir: string = DEFAULT_DIR,
): Promise<MigrateResult> {
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
  const client = new pg.Client({ connectionString });
  await client.connect();
  const result: MigrateResult = { applied: [], skipped: [] };
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS migracoes_aplicadas (
         versao TEXT NOT NULL,
         aplicada_em TIMESTAMPTZ NOT NULL DEFAULT now(),
         sha256 TEXT NOT NULL,
         CONSTRAINT pk_migracoes_aplicadas PRIMARY KEY (versao)
       )`,
    );
    for (const file of files) {
      const sql = await readFile(path.join(migrationsDir, file), "utf8");
      const sha256 = checksum(sql);
      // Checksums gravados antes desta correção foram calculados sobre os bytes brutos (com CRLF
      // quando o checkout no Windows converte as quebras de linha). Ainda são aceitos.
      const shaBruto = createHash("sha256").update(sql).digest("hex");
      await client.query("BEGIN");
      try {
        await client.query("SELECT pg_advisory_xact_lock($1)", [LOCK_KEY]);
        const found = await client.query<{ sha256: string }>(
          "SELECT sha256 FROM migracoes_aplicadas WHERE versao = $1",
          [file],
        );
        const existing = found.rows[0];
        if (existing) {
          if (existing.sha256 !== sha256 && existing.sha256 !== shaBruto) {
            throw new Error(
              `Migration ${file} foi alterada depois de aplicada (nunca edite migration já aplicada; crie uma nova).`,
            );
          }
          result.skipped.push(file);
        } else {
          await client.query(sql);
          await client.query("INSERT INTO migracoes_aplicadas (versao, sha256) VALUES ($1, $2)", [
            file,
            sha256,
          ]);
          result.applied.push(file);
        }
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }
    return result;
  } finally {
    await client.end();
  }
}
