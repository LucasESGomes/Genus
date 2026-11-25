/**
 * Candidatos reais: colaboradores ativos do estabelecimento do aparelho que têm
 * embedding facial, mais a DEK cifrada da empresa (banco `app`, papel somente
 * leitura `genus_coletor_leitura`). Contrato: docs/totem-contrato.md §4.
 *
 * - Filtra SEMPRE por `conta_id` e `estabelecimento_id` do contexto do aparelho.
 * - A engine recebe uma única DEK por requisição; por isso só entram embeddings
 *   cifrados com a DEK ATIVA da empresa (os de chave antiga, de uma rotação
 *   ainda não concluída, ficam de fora e são só contados no log).
 * - Teto de ENGINE_MAX_CANDIDATES por requisição. Acima disso, a galeria
 *   residente na engine (`/identify`, 02 §4.3) é trabalho futuro: aqui só
 *   avisamos, com contagem, e seguimos com os primeiros.
 * - Nada de CPF, embedding ou DEK em log.
 */
import {
  ENGINE_MAX_CANDIDATES,
  type Candidate,
  type CandidateProvider,
  type CandidateSet,
  type Clock,
  type DeviceContext,
  type Logger,
} from '@genus/shared';
import type { Pool } from 'pg';

export interface DbCandidateProviderOptions {
  pool: Pick<Pool, 'query'>;
  clock: Clock;
  logger: Logger;
  /** Padrão: ENGINE_MAX_CANDIDATES. */
  maxCandidates?: number;
}

interface CandidateRow {
  colaborador_id: string;
  cpf: string;
  nome: string;
  empresa_id: string;
  embedding_versao_chave: number;
  embedding_iv: Buffer;
  embedding_tag: Buffer;
  embedding_ct: Buffer;
  dek_versao_chave: number;
  dek_versao_kek: number;
  dek_iv: Buffer;
  dek_tag: Buffer;
  dek_ct: Buffer;
  total_sem_chave_ativa: string;
}

/**
 * `data_desligamento` é o último dia de trabalho: vale até ele, inclusive.
 * O dia de hoje é o de Brasília ([A CONFIRMAR]: fuso do estabelecimento, hoje fixo).
 */
const SQL = `
WITH base AS (
  SELECT c.id AS colaborador_id, c.cpf, c.nome,
         e.empresa_id, e.versao_chave AS embedding_versao_chave,
         e.embedding_iv, e.embedding_tag, e.embedding_ct,
         k.versao_chave AS dek_versao_chave, k.versao_kek AS dek_versao_kek,
         k.dek_iv, k.dek_tag, k.dek_ct,
         k.eh_ativa
    FROM rh.colaboradores c
    JOIN rh.embeddings_faciais e ON e.conta_id = c.conta_id AND e.colaborador_id = c.id
    JOIN rh.chaves_empresa k
      ON k.conta_id = e.conta_id AND k.empresa_id = e.empresa_id AND k.versao_chave = e.versao_chave
   WHERE c.conta_id = $1
     AND c.estabelecimento_id = $2
     AND (c.data_desligamento IS NULL OR c.data_desligamento >= $3::date)
)
SELECT b.*, (SELECT count(*) FROM base WHERE NOT eh_ativa) AS total_sem_chave_ativa
  FROM base b
 WHERE b.eh_ativa
 ORDER BY b.empresa_id, b.colaborador_id
 LIMIT $4`;

/**
 * Ninguém no estabelecimento tem rosto cadastrado (ainda). A lista vem vazia e o
 * PunchService nem chama a engine: responde `fallback_required`. A DEK vazia
 * nunca chega à engine.
 */
const EMPTY_DEK = { ivHex: '', tagHex: '', ciphertextHex: '', keyVersion: 1 };

export class DbCandidateProvider implements CandidateProvider {
  private readonly max: number;

  constructor(private readonly opts: DbCandidateProviderOptions) {
    this.max = Math.min(opts.maxCandidates ?? ENGINE_MAX_CANDIDATES, ENGINE_MAX_CANDIDATES);
  }

  async getCandidates(ctx: DeviceContext): Promise<CandidateSet> {
    const today = this.todayInBrasilia();
    // Um a mais que o teto: basta para saber que passou, sem trazer a galeria inteira.
    const { rows } = await this.opts.pool.query<CandidateRow>(SQL, [
      ctx.tenantId,
      ctx.establishmentId,
      today,
      this.max + 1,
    ]);

    const first = rows[0];
    if (!first) return { tenantDek: EMPTY_DEK, candidates: [] };

    // Uma DEK só por requisição: a da primeira empresa (um estabelecimento tem uma empresa só).
    const sameCompany = rows.filter((r) => r.empresa_id === first.empresa_id);
    const otherCompanies = rows.length - sameCompany.length;
    const overCap = sameCompany.length > this.max;
    const used = sameCompany.slice(0, this.max);
    const skippedOldKey = Number(first.total_sem_chave_ativa);

    if (overCap || otherCompanies > 0 || skippedOldKey > 0) {
      this.opts.logger.warn(
        {
          event: 'candidates_trimmed',
          tenantId: ctx.tenantId,
          establishmentId: ctx.establishmentId,
          used: used.length,
          max: this.max,
          overCap,
          otherCompanies,
          skippedOldKey,
        },
        'candidatos: lista cortada (teto da engine, outra empresa ou DEK antiga); galeria residente é trabalho futuro',
      );
    }

    const candidates: Candidate[] = used.map((r) => ({
      employeeId: Number(r.colaborador_id),
      cpf: r.cpf,
      displayName: r.nome,
      embedding: {
        ivHex: r.embedding_iv.toString('hex'),
        tagHex: r.embedding_tag.toString('hex'),
        ciphertextHex: r.embedding_ct.toString('hex'),
        keyVersion: r.embedding_versao_chave,
      },
    }));

    return {
      tenantDek: {
        ivHex: first.dek_iv.toString('hex'),
        tagHex: first.dek_tag.toString('hex'),
        ciphertextHex: first.dek_ct.toString('hex'),
        // Versão da MASTER_KEY que cifrou a DEK (vai à engine como dek_key_version).
        keyVersion: first.dek_versao_kek,
      },
      candidates,
    };
  }

  private todayInBrasilia(): string {
    // sv-SE formata como AAAA-MM-DD.
    return new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(this.opts.clock.now());
  }
}
