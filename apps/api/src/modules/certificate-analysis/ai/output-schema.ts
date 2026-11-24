/**
 * Contrato da saída da IA. Toda resposta do provedor passa por `parseAiOutput`:
 * fora do schema vira `AiProviderError('saida_fora_do_schema')`, nunca dado gravado.
 *
 * Chaves em inglês (CLAUDE.md: JSON em camelCase); valores de enumeração em português.
 */
import { z } from 'zod';
import { AiProviderError } from './provider';

export const FIELD_ITEMS = ['data_atestado', 'periodo_afastamento', 'profissional', 'legibilidade'] as const;
export const FIELD_STATUSES = ['ok', 'ausente', 'incoerente', 'ilegivel'] as const;
export const RECOMMENDATIONS = ['revisar_manual', 'sem_recomendacao'] as const;

export type FieldItem = (typeof FIELD_ITEMS)[number];
export type FieldStatusValue = (typeof FIELD_STATUSES)[number];
export type Recommendation = (typeof RECOMMENDATIONS)[number];

const confidence = z.number().min(0).max(1);

export const checkedFieldSchema = z.object({
  item: z.enum(FIELD_ITEMS),
  status: z.enum(FIELD_STATUSES),
  /** Trecho literal do texto que sustenta a situação; null se o campo está ausente. */
  evidence: z.string().max(300).nullable(),
});

export const possibilitySchema = z.object({
  /** Campo ambíguo: data_atestado, periodo_afastamento, profissional, crm, cid... */
  field: z.string().min(1).max(60),
  hypotheses: z
    .array(z.object({ value: z.string().min(1).max(120), confidence }))
    .min(1)
    .max(5),
});

export const aiOutputSchema = z
  .object({
    checkedFields: z.array(checkedFieldSchema).length(FIELD_ITEMS.length),
    possibilities: z.array(possibilitySchema).max(10),
    cidCodes: z.array(z.object({ code: z.string().min(3).max(8), confidence })).max(5),
    recommendation: z.enum(RECOMMENDATIONS),
  })
  .refine((o) => new Set(o.checkedFields.map((f) => f.item)).size === FIELD_ITEMS.length, {
    message: 'cada item verificado aparece uma vez',
    path: ['checkedFields'],
  });

export type AiOutput = z.infer<typeof aiOutputSchema>;

/**
 * JSON Schema enviado ao provedor (structured outputs). Os provedores não aceitam
 * limites numéricos nem de tamanho, então saem daqui; o Zod confere tudo depois.
 */
export function providerJsonSchema(): Record<string, unknown> {
  const raw = z.toJSONSchema(aiOutputSchema, { target: 'draft-2020-12', unrepresentable: 'any' }) as Record<string, unknown>;
  return clean(raw) as Record<string, unknown>;
}

const DROP = new Set(['$schema', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'multipleOf']);

function clean(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(clean);
  if (node === null || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    if (DROP.has(k)) continue;
    out[k] = clean(v);
  }
  if (out.type === 'object' && out.properties && typeof out.properties === 'object') {
    out.additionalProperties = false;
    out.required = Object.keys(out.properties);
  }
  return out;
}

/** Valida a resposta crua (string JSON ou objeto). Lança `AiProviderError` sem citar o conteúdo. */
export function parseAiOutput(raw: unknown): AiOutput {
  let value = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      throw new AiProviderError('saida_fora_do_schema', 'A resposta da IA não é JSON');
    }
  }
  const parsed = aiOutputSchema.safeParse(value);
  if (!parsed.success) {
    // Só os caminhos dos problemas: a mensagem do Zod pode ecoar valores do texto.
    const paths = [...new Set(parsed.error.issues.map((i) => i.path.join('.') || '(raiz)'))].slice(0, 5);
    throw new AiProviderError('saida_fora_do_schema', `A resposta da IA não segue o schema (${paths.join(', ')})`);
  }
  return parsed.data;
}

/** Normaliza espaços e caixa para conferir que a evidência é trecho do texto. */
const squash = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * A evidência precisa ser trecho do próprio texto enviado. Paráfrase do modelo
 * é descartada (vira null) e contada, para o relatório de comparação.
 */
export function keepLiteralEvidence(output: AiOutput, text: string): { output: AiOutput; discarded: number } {
  const haystack = squash(text);
  let discarded = 0;
  const checkedFields = output.checkedFields.map((f) => {
    if (f.evidence === null || haystack.includes(squash(f.evidence))) return f;
    discarded += 1;
    return { ...f, evidence: null };
  });
  return { output: { ...output, checkedFields }, discarded };
}
