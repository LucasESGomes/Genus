import { cp, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate, startArpTestDatabase, type ArpTestDatabase } from "../src/index";

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");

let db: ArpTestDatabase;
let collector: pg.Client;
let owner: pg.Client;
let seq = 0;

function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  seq += 1;
  return {
    conta_id: 1,
    estabelecimento_id: 1,
    aparelho_id: 1,
    sequencia_aparelho: 1000 + seq,
    colaborador_id: 1,
    cpf: "12345678901",
    marcado_em: "2026-11-18T12:00:00Z",
    recebido_em: "2026-11-18T12:00:01Z",
    metodo_identificacao: "facial",
    ...over,
  };
}

async function insert(client: pg.Client, over: Record<string, unknown> = {}, suffix = "") {
  const r = row(over);
  const cols = Object.keys(r);
  const params = cols.map((_, i) => `$${i + 1}`).join(", ");
  return client.query(
    `INSERT INTO entradas (${cols.join(", ")}) VALUES (${params}) ${suffix}`,
    Object.values(r),
  );
}

async function pgError(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return undefined;
}

beforeAll(async () => {
  db = await startArpTestDatabase();
  collector = new pg.Client({ connectionString: db.collectorUrl });
  owner = new pg.Client({ connectionString: db.ownerUrl });
  await collector.connect();
  await owner.connect();
});

afterAll(async () => {
  await collector?.end();
  await owner?.end();
  await db?.stop();
});

describe("migrations", () => {
  it("aplica do zero e registra a versão", async () => {
    const r = await owner.query("SELECT versao FROM migracoes_aplicadas ORDER BY versao");
    expect(r.rows.map((x) => x.versao)).toEqual(["0001_cria_entradas.sql"]);
  });

  it("rodar de novo é no-op", async () => {
    const r = await migrate(db.ownerUrl);
    expect(r.applied).toEqual([]);
    expect(r.skipped).toEqual(["0001_cria_entradas.sql"]);
  });

  it("falha se uma migration aplicada foi alterada", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "arp-mig-"));
    for (const f of await readdir(migrationsDir)) {
      await cp(path.join(migrationsDir, f), path.join(dir, f));
    }
    const file = path.join(dir, "0001_cria_entradas.sql");
    await writeFile(file, (await readFile(file, "utf8")) + "\n-- alterada\n");
    await expect(migrate(db.ownerUrl, dir)).rejects.toThrow(/alterada depois de aplicada/);
  });
});

describe("permissões de arp_collector", () => {
  it("consegue INSERT e SELECT", async () => {
    const r = await insert(collector, {}, "RETURNING id_publico");
    expect(r.rows).toHaveLength(1);
    const s = await collector.query("SELECT count(*)::int AS n FROM entradas WHERE conta_id = $1", [1]);
    expect(s.rows[0].n).toBeGreaterThan(0);
  });

  it("não consegue UPDATE", async () => {
    const code = await pgError(collector.query("UPDATE entradas SET status = 'processado' WHERE conta_id = 1"));
    expect(code).toBe("42501");
  });

  it("não consegue DELETE", async () => {
    const code = await pgError(collector.query("DELETE FROM entradas WHERE conta_id = 1"));
    expect(code).toBe("42501");
  });

  it("não consegue criar tabela", async () => {
    expect(await pgError(collector.query("CREATE TABLE intrusa (x int)"))).toBe("42501");
  });
});

describe("idempotência", () => {
  it("UNIQUE (aparelho_id, sequencia_aparelho) recusa duplicata", async () => {
    await insert(collector, { aparelho_id: 7, sequencia_aparelho: 5 });
    expect(await pgError(insert(collector, { aparelho_id: 7, sequencia_aparelho: 5 }))).toBe("23505");
  });

  it("ON CONFLICT DO NOTHING devolve zero linhas na segunda vez", async () => {
    const suffix = "ON CONFLICT (aparelho_id, sequencia_aparelho) DO NOTHING RETURNING id_publico";
    const over = { aparelho_id: 8, sequencia_aparelho: 9 };
    expect((await insert(collector, over, suffix)).rows).toHaveLength(1);
    expect((await insert(collector, over, suffix)).rows).toHaveLength(0);
  });
});

describe("CHECKs e defaults", () => {
  it("recusa cpf inválido", async () => {
    expect(await pgError(insert(collector, { cpf: "1234567890a" }))).toBe("23514");
  });
  it("recusa status fora da lista", async () => {
    expect(await pgError(insert(collector, { status: "qualquer" }))).toBe("23514");
  });
  it("recusa metodo_identificacao fora da lista", async () => {
    expect(await pgError(insert(collector, { metodo_identificacao: "senha" }))).toBe("23514");
  });
  it("recusa sequencia_aparelho 0", async () => {
    expect(await pgError(insert(collector, { sequencia_aparelho: 0 }))).toBe("23514");
  });
  it("recusa nota fora de 0..1", async () => {
    expect(await pgError(insert(collector, { nota_reconhecimento: 1.5 }))).toBe("23514");
  });
  it("status default é pendente e id_publico é gerado", async () => {
    const r = await insert(collector, {}, "RETURNING status, id_publico, tentativas, eh_hora_divergente");
    expect(r.rows[0].status).toBe("pendente");
    expect(r.rows[0].id_publico).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.rows[0].tentativas).toBe(0);
    expect(r.rows[0].eh_hora_divergente).toBe(false);
  });
});
