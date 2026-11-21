import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startArpTestDatabase, type ArpTestDatabase } from "../src/index";

const EVENTOS = ["generate-receipt-pdf", "recalculate-day", "official-qr"] as const;
const RESTRICT_VIOLATION = "23001";
const PERMISSAO_NEGADA = "42501";
const UNIQUE = "23505";
const CHECK = "23514";

let db: ArpTestDatabase;
let owner: pg.Client;
let collector: pg.Client;
let core: pg.Client;
let reader: pg.Client;
let admin: pg.Client | undefined;
// Cada teste usa um estabelecimento e um aparelho próprios (dados independentes).
let proximo = 1000;

async function pgError(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return undefined;
}

interface Cenario {
  estabelecimentoId: number;
  aparelhoId: number;
  entradaId: number;
  chave: string;
}

/** Entrada pendente inserida como arp_collector, num estabelecimento novo. */
async function novaEntrada(): Promise<Cenario> {
  proximo += 1;
  const estabelecimentoId = proximo;
  const aparelhoId = proximo;
  const r = await collector.query<{ id: string }>(
    `INSERT INTO entradas (conta_id, estabelecimento_id, aparelho_id, sequencia_aparelho, colaborador_id,
                           cpf, marcado_em, recebido_em, metodo_identificacao)
     VALUES (1, $1, $2, 1, 1, '12345678901', now(), now(), 'facial') RETURNING id`,
    [estabelecimentoId, aparelhoId],
  );
  return { estabelecimentoId, aparelhoId, entradaId: Number(r.rows[0]!.id), chave: `${estabelecimentoId}-1` };
}

function inserirRegistro(client: pg.Client, c: Cenario, hash: Buffer = randomBytes(32)) {
  return client.query(
    `INSERT INTO registros (estabelecimento_id, nsr, conta_id, tipo, cpf, marcado_em, gravado_em,
                            tipo_coletor, eh_offline, hash, hash_anterior, versao_formato_hash)
     VALUES ($1, 1, 1, '7', '12345678901', now(), now(), '01', false, $2, $3, 1)`,
    [c.estabelecimentoId, hash, Buffer.alloc(32)],
  );
}

function inserirEvidencia(client: pg.Client, c: Cenario) {
  return client.query(
    `INSERT INTO evidencias (estabelecimento_id, nsr, conta_id, entrada_id, aparelho_id, sequencia_aparelho,
                             colaborador_id, metodo_identificacao)
     VALUES ($1, 1, 1, $2, $3, 1, 1, 'facial')`,
    [c.estabelecimentoId, c.entradaId, c.aparelhoId],
  );
}

function inserirEvento(client: pg.Client, c: Cenario, evento: string) {
  return client.query(
    `INSERT INTO outbox (conta_id, estabelecimento_id, evento, chave, payload)
     VALUES (1, $1, $2, $3, $4)`,
    [c.estabelecimentoId, evento, c.chave, JSON.stringify({ establishmentId: c.estabelecimentoId, nsr: 1 })],
  );
}

/** Registro + evidência como arp_core, sem eventos. */
async function registrar(c: Cenario) {
  await inserirRegistro(core, c);
  await inserirEvidencia(core, c);
}

function processar(client: pg.Client, c: Cenario) {
  return client.query("UPDATE entradas SET status = 'processado', processado_em = now() WHERE id = $1", [
    c.entradaId,
  ]);
}

beforeAll(async () => {
  db = await startArpTestDatabase();
  owner = new pg.Client({ connectionString: db.ownerUrl });
  collector = new pg.Client({ connectionString: db.collectorUrl });
  core = new pg.Client({ connectionString: db.coreUrl });
  reader = new pg.Client({ connectionString: db.readerUrl });
  await Promise.all([owner.connect(), collector.connect(), core.connect(), reader.connect()]);
  // `testing.ts` pode expor uma conexão de superusuário; se não expuser, o teste fica pendente.
  const adminUrl = (db as unknown as { adminUrl?: string }).adminUrl;
  if (adminUrl) {
    admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
  }
});

afterAll(async () => {
  await Promise.all([owner, collector, core, reader, admin].map((c) => c?.end()));
  await db?.stop();
});

describe("migration 0002", () => {
  it("é aplicada sobre a 0001 e registrada em migracoes_aplicadas", async () => {
    const r = await owner.query<{ versao: string }>("SELECT versao FROM migracoes_aplicadas ORDER BY versao");
    const versoes = r.rows.map((x) => x.versao);
    expect(versoes).toContain("0001_cria_entradas.sql");
    expect(versoes.some((v) => /^0002_.*\.sql$/.test(v))).toBe(true);
  });
});

describe("imutabilidade de registros e evidencias", () => {
  const tabelas = ["registros", "evidencias"] as const;

  async function semear() {
    const c = await novaEntrada();
    await registrar(c);
    return c;
  }

  for (const tabela of tabelas) {
    const coluna = tabela === "registros" ? "tipo_coletor = '02'" : "colaborador_id = 2";

    it(`arp_owner não consegue UPDATE, DELETE nem TRUNCATE em ${tabela}`, async () => {
      await semear();
      expect(await pgError(owner.query(`UPDATE ${tabela} SET ${coluna}`))).toBe(RESTRICT_VIOLATION);
      expect(await pgError(owner.query(`DELETE FROM ${tabela}`))).toBe(RESTRICT_VIOLATION);
      expect(await pgError(owner.query(`TRUNCATE ${tabela} CASCADE`))).toBe(RESTRICT_VIOLATION);
    });

    it(`arp_core não consegue UPDATE, DELETE nem TRUNCATE em ${tabela}`, async () => {
      await semear();
      expect(await pgError(core.query(`UPDATE ${tabela} SET ${coluna}`))).toBe(PERMISSAO_NEGADA);
      expect(await pgError(core.query(`DELETE FROM ${tabela}`))).toBe(PERMISSAO_NEGADA);
      expect(await pgError(core.query(`TRUNCATE ${tabela}`))).toBe(PERMISSAO_NEGADA);
    });

    it(`o superusuário não consegue UPDATE, DELETE nem TRUNCATE em ${tabela}`, async (ctx) => {
      if (!admin) {
        ctx.skip(); // pendente: testing.ts ainda não expõe uma conexão de superusuário (adminUrl)
        return;
      }
      await semear();
      expect(await pgError(admin.query(`UPDATE ${tabela} SET ${coluna}`))).toBe(RESTRICT_VIOLATION);
      expect(await pgError(admin.query(`DELETE FROM ${tabela}`))).toBe(RESTRICT_VIOLATION);
      expect(await pgError(admin.query(`TRUNCATE ${tabela} CASCADE`))).toBe(RESTRICT_VIOLATION);
    });
  }

  it("a mensagem de erro do trigger está em pt-BR", async () => {
    await semear();
    await expect(owner.query("DELETE FROM registros")).rejects.toThrow(/só aceita INSERT/);
  });
});

describe("permissões de arp_core", () => {
  it("não consegue DELETE nem TRUNCATE em entradas, outbox e sequencias_estabelecimento", async () => {
    for (const t of ["entradas", "outbox", "sequencias_estabelecimento"]) {
      expect(await pgError(core.query(`DELETE FROM ${t}`)), `DELETE ${t}`).toBe(PERMISSAO_NEGADA);
      expect(await pgError(core.query(`TRUNCATE ${t}`)), `TRUNCATE ${t}`).toBe(PERMISSAO_NEGADA);
    }
  });

  it("não consegue UPDATE de colunas de entradas fora de status, tentativas e processado_em", async () => {
    const c = await novaEntrada();
    for (const set of ["cpf = '00000000000'", "marcado_em = now()", "colaborador_id = 9", "conta_id = 2"]) {
      expect(await pgError(core.query(`UPDATE entradas SET ${set} WHERE id = $1`, [c.entradaId])), set).toBe(
        PERMISSAO_NEGADA,
      );
    }
  });

  it("consegue UPDATE de tentativas em entrada pendente", async () => {
    const c = await novaEntrada();
    await core.query("UPDATE entradas SET tentativas = tentativas + 1 WHERE id = $1", [c.entradaId]);
    const r = await core.query("SELECT tentativas FROM entradas WHERE id = $1", [c.entradaId]);
    expect(r.rows[0].tentativas).toBe(1);
  });

  it("consegue INSERT e UPDATE em sequencias_estabelecimento", async () => {
    proximo += 1;
    await core.query("INSERT INTO sequencias_estabelecimento (estabelecimento_id, conta_id) VALUES ($1, 1)", [proximo]);
    await core.query("UPDATE sequencias_estabelecimento SET ultimo_nsr = 1 WHERE estabelecimento_id = $1", [proximo]);
    const r = await core.query("SELECT ultimo_nsr FROM sequencias_estabelecimento WHERE estabelecimento_id = $1", [
      proximo,
    ]);
    expect(Number(r.rows[0].ultimo_nsr)).toBe(1);
  });
});

describe("trigger de entradas: o banco exige o registro para processar", () => {
  it("o dono não consegue alterar colunas da batida em entradas", async () => {
    const c = await novaEntrada();
    expect(await pgError(owner.query("UPDATE entradas SET cpf = '00000000000' WHERE id = $1", [c.entradaId]))).toBe(
      RESTRICT_VIOLATION,
    );
  });

  it("recusa processado sem evidência", async () => {
    const c = await novaEntrada();
    expect(await pgError(processar(core, c))).toBe(RESTRICT_VIOLATION);
  });

  it("recusa processado com evidência e nenhum evento", async () => {
    const c = await novaEntrada();
    await registrar(c);
    expect(await pgError(processar(core, c))).toBe(RESTRICT_VIOLATION);
  });

  it("recusa processado com evidência e 1 evento", async () => {
    const c = await novaEntrada();
    await registrar(c);
    await inserirEvento(core, c, EVENTOS[0]);
    expect(await pgError(processar(core, c))).toBe(RESTRICT_VIOLATION);
  });

  it("recusa processado com evidência e 2 eventos", async () => {
    const c = await novaEntrada();
    await registrar(c);
    await inserirEvento(core, c, EVENTOS[0]);
    await inserirEvento(core, c, EVENTOS[1]);
    expect(await pgError(processar(core, c))).toBe(RESTRICT_VIOLATION);
  });

  it("recusa processado se os eventos são de outra chave", async () => {
    const c = await novaEntrada();
    await registrar(c);
    for (const e of EVENTOS) await inserirEvento(core, { ...c, chave: `${c.estabelecimentoId}-2` }, e);
    expect(await pgError(processar(core, c))).toBe(RESTRICT_VIOLATION);
  });

  it("aceita processado com evidência e os 3 eventos, e depois recusa sair de processado", async () => {
    const c = await novaEntrada();
    // Ordem certa: registro, evidência e outbox ANTES do UPDATE de status.
    await registrar(c);
    for (const e of EVENTOS) await inserirEvento(core, c, e);
    await processar(core, c);

    const r = await core.query("SELECT status, processado_em FROM entradas WHERE id = $1", [c.entradaId]);
    expect(r.rows[0].status).toBe("processado");
    expect(r.rows[0].processado_em).not.toBeNull();

    expect(await pgError(core.query("UPDATE entradas SET status = 'pendente' WHERE id = $1", [c.entradaId]))).toBe(
      RESTRICT_VIOLATION,
    );
    expect(await pgError(core.query("UPDATE entradas SET status = 'falhou' WHERE id = $1", [c.entradaId]))).toBe(
      RESTRICT_VIOLATION,
    );
    expect(
      await pgError(core.query("UPDATE entradas SET tentativas = tentativas + 1 WHERE id = $1", [c.entradaId])),
    ).toBe(RESTRICT_VIOLATION);
  });

  it("permite marcar falhou sem registro", async () => {
    const c = await novaEntrada();
    await core.query("UPDATE entradas SET status = 'falhou' WHERE id = $1", [c.entradaId]);
    const r = await core.query("SELECT status FROM entradas WHERE id = $1", [c.entradaId]);
    expect(r.rows[0].status).toBe("falhou");
  });
});

describe("permissões de arp_collector", () => {
  it("não consegue SELECT nem INSERT em registros", async () => {
    const c = await novaEntrada();
    expect(await pgError(collector.query("SELECT 1 FROM registros"))).toBe(PERMISSAO_NEGADA);
    expect(await pgError(inserirRegistro(collector, c))).toBe(PERMISSAO_NEGADA);
  });

  it("não consegue SELECT em outbox e sequencias_estabelecimento", async () => {
    for (const t of ["outbox", "sequencias_estabelecimento"]) {
      expect(await pgError(collector.query(`SELECT 1 FROM ${t}`)), t).toBe(PERMISSAO_NEGADA);
    }
  });

  it("lê evidencias (0003, consulta de status) e não escreve nela", async () => {
    const c = await novaEntrada();
    await registrar(c);
    await collector.query("SELECT nsr FROM evidencias");
    expect(await pgError(collector.query("DELETE FROM evidencias"))).toBe(PERMISSAO_NEGADA);
    expect(await pgError(collector.query("UPDATE evidencias SET nota_vivacidade = 0"))).toBe(PERMISSAO_NEGADA);
  });
});

describe("permissões de arp_reader", () => {
  it("consegue SELECT nas tabelas e não consegue INSERT", async () => {
    const c = await novaEntrada();
    await registrar(c);
    for (const t of ["entradas", "registros", "evidencias", "outbox", "sequencias_estabelecimento"]) {
      await reader.query(`SELECT count(*) FROM ${t}`);
    }
    expect(await pgError(inserirRegistro(reader, c))).toBe(PERMISSAO_NEGADA);
    expect(await pgError(inserirEvento(reader, c, EVENTOS[0]))).toBe(PERMISSAO_NEGADA);
    expect(await pgError(reader.query("UPDATE entradas SET tentativas = 5"))).toBe(PERMISSAO_NEGADA);
  });
});

describe("idempotência (UNIQUEs)", () => {
  it("evidencias recusa duplicata por entrada_id", async () => {
    const c = await novaEntrada();
    await registrar(c);
    // Segundo registro (nsr 2) tentando reaproveitar a mesma entrada.
    await core.query(
      `INSERT INTO registros (estabelecimento_id, nsr, conta_id, tipo, cpf, marcado_em, gravado_em,
                              tipo_coletor, eh_offline, hash, hash_anterior, versao_formato_hash)
       VALUES ($1, 2, 1, '7', '12345678901', now(), now(), '01', false, $2, $3, 1)`,
      [c.estabelecimentoId, randomBytes(32), randomBytes(32)],
    );
    const code = await pgError(
      core.query(
        `INSERT INTO evidencias (estabelecimento_id, nsr, conta_id, entrada_id, aparelho_id, sequencia_aparelho,
                                 colaborador_id, metodo_identificacao)
         VALUES ($1, 2, 1, $2, $3, 99, 1, 'facial')`,
        [c.estabelecimentoId, c.entradaId, c.aparelhoId],
      ),
    );
    expect(code).toBe(UNIQUE);
  });

  it("evidencias recusa duplicata por (aparelho_id, sequencia_aparelho)", async () => {
    const c = await novaEntrada();
    await registrar(c);
    const outra = await collector.query<{ id: string }>(
      `INSERT INTO entradas (conta_id, estabelecimento_id, aparelho_id, sequencia_aparelho, colaborador_id,
                             cpf, marcado_em, recebido_em, metodo_identificacao)
       VALUES (1, $1, $2, 2, 1, '12345678901', now(), now(), 'facial') RETURNING id`,
      [c.estabelecimentoId, c.aparelhoId],
    );
    await core.query(
      `INSERT INTO registros (estabelecimento_id, nsr, conta_id, tipo, cpf, marcado_em, gravado_em,
                              tipo_coletor, eh_offline, hash, hash_anterior, versao_formato_hash)
       VALUES ($1, 2, 1, '7', '12345678901', now(), now(), '01', false, $2, $3, 1)`,
      [c.estabelecimentoId, randomBytes(32), randomBytes(32)],
    );
    const code = await pgError(
      core.query(
        `INSERT INTO evidencias (estabelecimento_id, nsr, conta_id, entrada_id, aparelho_id, sequencia_aparelho,
                                 colaborador_id, metodo_identificacao)
         VALUES ($1, 2, 1, $2, $3, 1, 1, 'facial')`,
        [c.estabelecimentoId, Number(outra.rows[0]!.id), c.aparelhoId],
      ),
    );
    expect(code).toBe(UNIQUE);
  });

  it("outbox recusa (evento, chave) duplicado", async () => {
    const c = await novaEntrada();
    await inserirEvento(core, c, EVENTOS[0]);
    expect(await pgError(inserirEvento(core, c, EVENTOS[0]))).toBe(UNIQUE);
  });

  it("registros recusa NSR repetido no mesmo estabelecimento", async () => {
    const c = await novaEntrada();
    await inserirRegistro(core, c);
    expect(await pgError(inserirRegistro(core, c))).toBe(UNIQUE);
  });
});

describe("CHECKs", () => {
  it("registros recusa hash e hash_anterior com tamanho diferente de 32 bytes", async () => {
    const c = await novaEntrada();
    expect(await pgError(inserirRegistro(core, c, randomBytes(31)))).toBe(CHECK);
    expect(await pgError(inserirRegistro(core, c, randomBytes(33)))).toBe(CHECK);
    const code = await pgError(
      core.query(
        `INSERT INTO registros (estabelecimento_id, nsr, conta_id, tipo, cpf, marcado_em, gravado_em,
                                tipo_coletor, eh_offline, hash, hash_anterior, versao_formato_hash)
         VALUES ($1, 1, 1, '7', '12345678901', now(), now(), '01', false, $2, $3, 1)`,
        [c.estabelecimentoId, randomBytes(32), randomBytes(16)],
      ),
    );
    expect(code).toBe(CHECK);
  });

  it("registros recusa tipo 7 sem cpf, tipo e tipo_coletor inválidos", async () => {
    const c = await novaEntrada();
    const base = (tipo: string, cpf: string | null, coletor: string) =>
      core.query(
        `INSERT INTO registros (estabelecimento_id, nsr, conta_id, tipo, cpf, marcado_em, gravado_em,
                                tipo_coletor, eh_offline, hash, hash_anterior, versao_formato_hash)
         VALUES ($1, 1, 1, $2, $3, now(), now(), $4, false, $5, $5, 1)`,
        [c.estabelecimentoId, tipo, cpf, coletor, Buffer.alloc(32)],
      );
    expect(await pgError(base("7", null, "01"))).toBe(CHECK);
    expect(await pgError(base("3", "12345678901", "01"))).toBe(CHECK);
    expect(await pgError(base("7", "12345678901", "06"))).toBe(CHECK);
    expect(await pgError(base("7", "1234567890a", "01"))).toBe(CHECK);
  });

  it("outbox recusa evento e status fora da lista", async () => {
    const c = await novaEntrada();
    expect(await pgError(inserirEvento(core, c, "evento-inexistente"))).toBe(CHECK);
    const code = await pgError(
      core.query(
        `INSERT INTO outbox (conta_id, estabelecimento_id, evento, chave, payload, status)
         VALUES (1, $1, 'official-qr', $2, '{}', 'qualquer')`,
        [c.estabelecimentoId, c.chave],
      ),
    );
    expect(code).toBe(CHECK);
  });

  it("sequencias_estabelecimento recusa ultimo_nsr negativo", async () => {
    proximo += 1;
    expect(
      await pgError(
        core.query(
          "INSERT INTO sequencias_estabelecimento (estabelecimento_id, conta_id, ultimo_nsr) VALUES ($1, 1, -1)",
          [proximo],
        ),
      ),
    ).toBe(CHECK);
  });
});
