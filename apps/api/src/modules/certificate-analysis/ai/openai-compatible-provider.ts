/**
 * Provedor genérico no formato OpenAI (`/chat/completions` com
 * `response_format: json_schema`). Serve OpenAI, OpenRouter, Groq e, principalmente,
 * um modelo LOCAL (Ollama, vLLM, LM Studio), o que mantém o atestado dentro da
 * infraestrutura, como recomenda 04 G6.
 *
 * Sem chave (modelo local): a requisição sai sem `Authorization`.
 */
import { providerJsonSchema } from './output-schema';
import { SYSTEM_PROMPT, userPrompt } from './prompt';
import { AiProviderError, postJson, type AiAnalysisInput, type CertificateAiProvider, type FetchLike } from './provider';

export interface OpenAiCompatibleOptions {
  baseUrl: string;
  model: string;
  apiKey?: string | null;
  timeoutMs: number;
  fetch?: FetchLike;
}

interface ChatResponse {
  choices?: { finish_reason?: string; message?: { content?: string | null; refusal?: string | null } }[];
}

export class OpenAiCompatibleCertificateAiProvider implements CertificateAiProvider {
  readonly provider = 'openai_compativel' as const;
  readonly model: string;
  private readonly url: string;
  private readonly fetchImpl: FetchLike;

  constructor(private readonly o: OpenAiCompatibleOptions) {
    this.model = o.model;
    this.url = `${o.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    this.fetchImpl = o.fetch ?? (fetch as unknown as FetchLike);
  }

  async analyze(input: AiAnalysisInput): Promise<unknown> {
    const body = {
      model: this.model,
      temperature: 0,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt(input.text) },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'analise_atestado', strict: true, schema: providerJsonSchema() } },
    };
    const headers: Record<string, string> = this.o.apiKey ? { authorization: `Bearer ${this.o.apiKey}` } : {};
    const res = (await postJson(this.fetchImpl, this.url, headers, body, this.o.timeoutMs)) as ChatResponse;
    const choice = res.choices?.[0];
    if (choice?.message?.refusal) throw new AiProviderError('recusa_do_modelo', 'O modelo recusou a análise');
    if (choice?.finish_reason === 'length') throw new AiProviderError('saida_truncada', 'A resposta do modelo foi cortada');
    const content = choice?.message?.content;
    if (typeof content !== 'string') throw new AiProviderError('saida_fora_do_schema', 'A resposta do modelo não tem conteúdo');
    return content;
  }
}
