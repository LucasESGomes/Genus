/**
 * Provedor Anthropic (Messages API) por HTTP, sem SDK: decisão do projeto de não
 * acrescentar dependência para uma chamada só. Saída estruturada por
 * `output_config.format` (json_schema); esforço `low` (tarefa de extração).
 * Modelo padrão sugerido: `claude-haiku-5-5` (barato e com structured outputs).
 *
 * A chave vem do ambiente (CERTIFICATE_AI_ANTHROPIC_API_KEY) e nunca vai para log.
 */
import { providerJsonSchema } from './output-schema';
import { SYSTEM_PROMPT, userPrompt } from './prompt';
import { AiProviderError, postJson, type AiAnalysisInput, type CertificateAiProvider, type FetchLike } from './provider';

export const ANTHROPIC_API_VERSION = '2026-10-21';

export interface AnthropicOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  timeoutMs: number;
  fetch?: FetchLike;
}

interface MessagesResponse {
  stop_reason?: string;
  content?: { type: string; text?: string }[];
}

export class AnthropicCertificateAiProvider implements CertificateAiProvider {
  readonly provider = 'anthropic' as const;
  readonly model: string;
  private readonly url: string;
  private readonly fetchImpl: FetchLike;

  constructor(private readonly o: AnthropicOptions) {
    this.model = o.model;
    this.url = `${(o.baseUrl ?? 'https://api.anthropic.com').replace(/\/+$/, '')}/v1/messages`;
    this.fetchImpl = o.fetch ?? (fetch as unknown as FetchLike);
  }

  async analyze(input: AiAnalysisInput): Promise<unknown> {
    const body = {
      model: this.model,
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt(input.text) }],
      output_config: { effort: 'low', format: { type: 'json_schema', schema: providerJsonSchema() } },
    };
    const res = (await postJson(
      this.fetchImpl,
      this.url,
      { 'x-api-key': this.o.apiKey, 'anthropic-version': ANTHROPIC_API_VERSION },
      body,
      this.o.timeoutMs,
    )) as MessagesResponse;

    if (res.stop_reason === 'refusal') throw new AiProviderError('recusa_do_modelo', 'O modelo recusou a análise');
    if (res.stop_reason === 'max_tokens') throw new AiProviderError('saida_truncada', 'A resposta do modelo foi cortada');
    const text = res.content?.find((b) => b.type === 'text')?.text;
    if (typeof text !== 'string') throw new AiProviderError('saida_fora_do_schema', 'A resposta do modelo não tem bloco de texto');
    return text;
  }
}
