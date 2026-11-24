/**
 * Escolha do provedor a partir do ambiente. Sem provedor decidido, sem modelo ou
 * sem chave: usa a mock e avisa (`IA_SIMULADA`). Nunca falha a partida da api.
 *
 * Especificação de modelo: `provedor:modelo`, ex. `mock:v1`, `mock:estrito`,
 * `anthropic:claude-haiku-5-5`, `openai_compativel:llama3.1:8b`.
 */
import { AnthropicCertificateAiProvider } from './anthropic-provider';
import { MOCK_MODELS, MockCertificateAiProvider, type MockModel } from './mock-provider';
import { OpenAiCompatibleCertificateAiProvider } from './openai-compatible-provider';
import { PROVIDER_IDS, type CertificateAiProvider, type FetchLike, type ProviderId } from './provider';

export interface CertificateAiConfig {
  /** Provedor padrão; null = não decidido (usa a mock). */
  provider: ProviderId | null;
  model: string | null;
  anthropicApiKey: string | null;
  anthropicBaseUrl: string | null;
  openaiApiKey: string | null;
  openaiBaseUrl: string | null;
  timeoutMs: number;
}

export const AI_WARNINGS = {
  IA_SIMULADA: 'IA simulada (mock determinística): nenhum provedor real configurado.',
} as const;

export interface ResolvedProvider {
  provider: CertificateAiProvider;
  /** Avisos que vão na resposta (ex.: caiu na mock). */
  warnings: string[];
}

export class UnknownModelError extends Error {
  override readonly name = 'UnknownModelError';
}

export function parseModelSpec(spec: string): { provider: ProviderId; model: string } {
  const i = spec.indexOf(':');
  const provider = (i < 0 ? spec : spec.slice(0, i)) as ProviderId;
  const model = i < 0 ? '' : spec.slice(i + 1);
  if (!PROVIDER_IDS.includes(provider) || model.length === 0) {
    throw new UnknownModelError(`Modelo inválido: use provedor:modelo (${PROVIDER_IDS.join(', ')})`);
  }
  return { provider, model };
}

export class CertificateAiRegistry {
  constructor(
    private readonly cfg: CertificateAiConfig,
    private readonly fetchImpl?: FetchLike,
  ) {}

  /** Provedor padrão do ambiente, ou a mock com aviso. */
  default(): ResolvedProvider {
    const { provider, model } = this.cfg;
    if (provider === null || provider === 'mock' || model === null) {
      const m = provider === 'mock' && model && (MOCK_MODELS as readonly string[]).includes(model) ? (model as MockModel) : 'v1';
      return { provider: new MockCertificateAiProvider(m), warnings: ['IA_SIMULADA'] };
    }
    try {
      return { provider: this.build(provider, model), warnings: [] };
    } catch {
      // Provedor escolhido sem a chave/URL: não derruba nada, analisa com a mock e avisa.
      return { provider: new MockCertificateAiProvider('v1'), warnings: ['IA_SIMULADA'] };
    }
  }

  /** Provedor de uma especificação `provedor:modelo`. Lança `UnknownModelError` se não der para montar. */
  resolve(spec: string): ResolvedProvider {
    const { provider, model } = parseModelSpec(spec);
    const built = this.build(provider, model);
    return { provider: built, warnings: provider === 'mock' ? ['IA_SIMULADA'] : [] };
  }

  /** Modelos configurados para a comparação, além da mock. */
  available(): string[] {
    const out = MOCK_MODELS.map((m) => `mock:${m}`);
    if (this.cfg.provider && this.cfg.provider !== 'mock' && this.cfg.model) out.push(`${this.cfg.provider}:${this.cfg.model}`);
    return out;
  }

  private build(provider: ProviderId, model: string): CertificateAiProvider {
    const timeoutMs = this.cfg.timeoutMs;
    switch (provider) {
      case 'mock':
        if (!(MOCK_MODELS as readonly string[]).includes(model)) {
          throw new UnknownModelError(`Modelo mock desconhecido: use ${MOCK_MODELS.join(' ou ')}`);
        }
        return new MockCertificateAiProvider(model as MockModel);
      case 'anthropic':
        if (!this.cfg.anthropicApiKey) throw new UnknownModelError('Provedor anthropic sem CERTIFICATE_AI_ANTHROPIC_API_KEY');
        return new AnthropicCertificateAiProvider({
          apiKey: this.cfg.anthropicApiKey,
          model,
          baseUrl: this.cfg.anthropicBaseUrl ?? undefined,
          timeoutMs,
          fetch: this.fetchImpl,
        });
      case 'openai_compativel':
        if (!this.cfg.openaiBaseUrl) throw new UnknownModelError('Provedor openai_compativel sem CERTIFICATE_AI_OPENAI_BASE_URL');
        return new OpenAiCompatibleCertificateAiProvider({
          baseUrl: this.cfg.openaiBaseUrl,
          apiKey: this.cfg.openaiApiKey,
          model,
          timeoutMs,
          fetch: this.fetchImpl,
        });
    }
  }
}

/** Configuração vazia: tudo na mock. Testes e script sem ambiente usam esta. */
export const MOCK_ONLY_CONFIG: CertificateAiConfig = {
  provider: null,
  model: null,
  anthropicApiKey: null,
  anthropicBaseUrl: null,
  openaiApiKey: null,
  openaiBaseUrl: null,
  timeoutMs: 20_000,
};
