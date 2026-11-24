/**
 * Interface do provedor de IA da análise de atestado. Toda implementação recebe
 * só o texto já anonimizado (sem CPF e nome) e devolve a resposta CRUA: quem
 * valida contra o schema é o service (`parseAiOutput`).
 *
 * Nenhum erro carrega o texto do atestado nem a resposta do provedor: a mensagem
 * vai para log e para a coluna `falha`.
 */

export const PROVIDER_IDS = ['mock', 'anthropic', 'openai_compativel'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export interface AiAnalysisInput {
  /** Texto anonimizado, já pronto para sair da infraestrutura. */
  text: string;
  promptVersion: string;
}

export interface CertificateAiProvider {
  readonly provider: ProviderId;
  readonly model: string;
  /** Resposta crua do modelo (string JSON ou objeto). */
  analyze(input: AiAnalysisInput): Promise<unknown>;
}

export const AI_FAILURES = [
  'saida_fora_do_schema',
  'provedor_indisponivel',
  'tempo_esgotado',
  'recusa_do_modelo',
  'saida_truncada',
  'dados_pessoais_no_envio',
] as const;
export type AiFailure = (typeof AI_FAILURES)[number];

export class AiProviderError extends Error {
  override readonly name = 'AiProviderError';
  constructor(
    readonly code: AiFailure,
    message: string,
    /** Status HTTP do provedor, quando houver. */
    readonly httpStatus?: number,
  ) {
    super(message);
  }
}

/** `fetch` injetável (testes trocam por um falso). */
export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

/** Chama o provedor com tempo limite e traduz falha de rede/HTTP para `AiProviderError`. */
export async function postJson(
  fetchImpl: FetchLike,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
): Promise<unknown> {
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new AiProviderError('tempo_esgotado', `O provedor não respondeu em ${timeoutMs} ms`);
    }
    throw new AiProviderError('provedor_indisponivel', 'Falha de rede ao chamar o provedor de IA');
  }
  if (!res.ok) throw new AiProviderError('provedor_indisponivel', `O provedor de IA respondeu HTTP ${res.status}`, res.status);
  try {
    return await res.json();
  } catch {
    throw new AiProviderError('saida_fora_do_schema', 'O provedor de IA não devolveu JSON');
  }
}
