/**
 * Contratos HTTP da análise de atestado (G6). Só o RH chama estas rotas; mesmo
 * assim a resposta não traz hash do arquivo, texto completo nem chave de nada.
 * O CID aparece interpretado (capítulo), porque o RH é o único perfil que vê CID.
 */
import { z } from 'zod';
import { FIELD_ITEMS, FIELD_STATUSES, RECOMMENDATIONS } from './ai/output-schema';
import { AI_FAILURES } from './ai/provider';

export const MAX_TEXT_CHARS = 20_000;

export const analyzeCertificateBody = z.object({
  /** Texto extraído do atestado (OCR ou digitado pelo RH). Fica cifrado, nunca em log. */
  text: z.string().trim().min(20, 'o texto do atestado é curto demais para analisar').max(MAX_TEXT_CHARS),
  /** Modelos a rodar (`provedor:modelo`). Sem a lista: o padrão do ambiente. Dois ou mais: gera comparação. */
  models: z
    .array(z.string().trim().min(3).max(120))
    .min(1)
    .max(4)
    .refine((m) => new Set(m).size === m.length, 'modelo repetido')
    .optional(),
});

const findingDto = z.object({ code: z.string(), severity: z.enum(['alta', 'media', 'baixa']), message: z.string() });

export const analysisDto = z.object({
  id: z.number(),
  certificateId: z.number(),
  provider: z.enum(['regras', 'mock', 'anthropic', 'openai_compativel']),
  model: z.string().nullable(),
  promptVersion: z.string().nullable(),
  rulesVersion: z.string(),
  inputHash: z.string().nullable(),
  analyzedAt: z.string(),
  responseMs: z.number().nullable(),
  /** Sempre presente: a análise é indicativa e não comprova autenticidade. */
  notice: z.string().min(1),
  warnings: z.array(z.string()),
  recommendation: z.enum(RECOMMENDATIONS),
  ai: z.object({ status: z.enum(['concluida', 'nao_executada', 'falhou']), failure: z.enum(AI_FAILURES).nullable() }),
  checkedFields: z.array(z.object({ item: z.enum(FIELD_ITEMS), status: z.enum(FIELD_STATUSES), evidence: z.string().nullable() })),
  possibilities: z.array(z.object({ field: z.string(), hypotheses: z.array(z.object({ value: z.string(), confidence: z.number() })) })),
  cid: z
    .array(
      z.object({
        code: z.string(),
        chapter: z.string().nullable(),
        chapterTitle: z.string().nullable(),
        status: z.enum(['valido', 'fora_da_tabela']),
        confidence: z.number(),
        source: z.enum(['regra', 'ia']),
      }),
    )
    .nullable(),
  risk: z.object({ score: z.number(), level: z.enum(['baixo', 'medio', 'alto']), findings: z.array(findingDto) }),
  reliability: z.object({ score: z.number(), band: z.enum(['baixa', 'media', 'alta']), cap: z.number() }),
});

export type AnalysisDto = z.infer<typeof analysisDto>;

const comparisonDto = z.object({
  agreementByField: z.record(z.string(), z.number()),
  divergences: z.array(z.object({ field: z.string(), values: z.record(z.string(), z.string()) })),
  responseMs: z.record(z.string(), z.number().nullable()),
});

export const analyzeCertificateResponse = z.object({
  data: z.object({
    certificateId: z.number(),
    /** O status do atestado depois da análise: a IA nunca o altera. */
    certificateStatus: z.enum(['pendente', 'aprovado', 'recusado']),
    analyses: z.array(analysisDto),
    comparison: comparisonDto.nullable(),
  }),
});

export const listAnalysesResponse = z.object({ data: z.array(analysisDto) });
