/**
 * Schema `rh` do banco `app` e os tipos de coluna que o Drizzle não traz pronto.
 * A fonte da estrutura é `apps/api/schema-rh.sql`; este diretório a traduz para o
 * código: nome da coluna em português, propriedade em inglês (database.md §12).
 */
import { bigint, customType, pgSchema } from 'drizzle-orm/pg-core';

export const rh = pgSchema('rh');

/** E-mail sem diferenciar maiúsculas (extensão `citext`, criada na migration 0000). */
export const citext = customType<{ data: string }>({
  dataType: () => 'citext',
});

/** Dado cifrado na aplicação (AES-GCM). Nunca sai na API nem em log. */
export const bytea = customType<{ data: Buffer }>({
  dataType: () => 'bytea',
});

/** Chave primária padrão: `id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY`. */
export const id = () => bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity();

/** Chave estrangeira ou referência lógica (bigint). */
export const ref = (name: string) => bigint(name, { mode: 'number' });

/**
 * Conta (tenant), logo após o `id` em toda tabela de negócio (CLAUDE.md, multi-tenant).
 * As FKs entre tabelas da conta são compostas `(conta_id, x_id) → pai (conta_id, id)`:
 * o banco recusa ligar linhas de contas diferentes. Vem da sessão, nunca do corpo da requisição.
 */
export const tenantId = () => ref('conta_id');
