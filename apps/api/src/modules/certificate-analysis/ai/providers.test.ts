/** Provedores de IA: schema da saída, mock determinística, clientes HTTP com fetch falso e escolha pelo ambiente. */
import { describe, expect, it } from 'vitest';
import { AnthropicCertificateAiProvider, ANTHROPIC_API_VERSION } from './anthropic-provider';
import { mockAnalysis, MockCertificateAiProvider } from './mock-provider';
import { OpenAiCompatibleCertificateAiProvider } from './openai-compatible-provider';
import { keepLiteralEvidence, parseAiOutput, providerJsonSchema, type AiOutput } from './output-schema';
import { PROMPT_VERSION } from './prompt';
import { AiProviderError, type FetchLike } from './provider';
import { CertificateAiRegistry, MOCK_ONLY_CONFIG, parseModelSpec } from './registry';

const valid: AiOutput = {
  checkedFields: [
    { item: 'data_atestado', status: 'ok', evidence: 'Data: 18/11/2026' },
    { item: 'periodo_afastamento', status: 'ok', evidence: '3 (três) dias' },
    { item: 'profissional', status: 'ok', evidence: 'CRM-SP 123456' },
    { item: 'legibilidade', status: 'ok', evidence: null },
  ],
  possibilities: [],
  cidCodes: [],
  recommendation: 'sem_recomendacao',
};

function fakeFetch(respond: (body: Record<string, unknown>) => { status?: number; json: unknown }) {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const fn: FetchLike = async (url, init) => {
    const body = JSON.parse(init.body) as Record<string, unknown>;
    calls.push({ url, headers: init.headers, body });
    const r = respond(body);
    return { ok: (r.status ?? 200) < 400, status: r.status ?? 200, json: async () => r.json };
  };
  return { fn, calls };
}

describe('schema da saída da IA', () => {
  it('aceita a saída válida e recusa o que foge do schema, sem ecoar valores', () => {
    expect(parseAiOutput(JSON.stringify(valid))).toEqual(valid);
    const cases: unknown[] = [
      'não é json',
      { ...valid, recommendation: 'aprovar' },
      { ...valid, checkedFields: valid.checkedFields.slice(0, 3) },
      { ...valid, checkedFields: [...valid.checkedFields.slice(0, 3), { ...valid.checkedFields[0]!, item: 'data_atestado' }] },
      { ...valid, possibilities: [{ field: 'data_atestado', hypotheses: [{ value: '10/11/2026', confidence: 1.4 }] }] },
      { ...valid, checkedFields: valid.checkedFields.map((f) => ({ ...f, status: 'verdadeiro' })) },
    ];
    for (const c of cases) {
      let err: unknown;
      try {
        parseAiOutput(c);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(AiProviderError);
      expect((err as AiProviderError).code).toBe('saida_fora_do_schema');
      expect((err as Error).message).not.toMatch(/10\/11\/2026|aprovar|verdadeiro/);
    }
  });

  it('JSON Schema para o provedor: objetos fechados, todos os campos obrigatórios, sem limites numéricos', () => {
    const s = JSON.stringify(providerJsonSchema());
    expect(s).toContain('"additionalProperties":false');
    expect(s).not.toMatch(/"minimum"|"maximum"|"minItems"|"maxLength"/);
    const root = providerJsonSchema() as { required: string[] };
    expect(root.required.sort()).toEqual(['checkedFields', 'cidCodes', 'possibilities', 'recommendation']);
  });

  it('evidência que não é trecho do texto é descartada', () => {
    const { output, discarded } = keepLiteralEvidence(
      { ...valid, checkedFields: valid.checkedFields.map((f, i) => (i === 0 ? { ...f, evidence: 'emitido em dezoito de novembro' } : f)) },
      'Data:   18/11/2026\n3 (três) dias\nCRM-SP 123456',
    );
    expect(discarded).toBe(1);
    expect(output.checkedFields[0]!.evidence).toBeNull();
    expect(output.checkedFields[1]!.evidence).toBe('3 (três) dias');
  });
});

describe('mock determinística', () => {
  const text = 'Atesto 3 (três) dias a partir de 18/11/2026.\nDra. Helena Duarte\nCRM-SP 123456\nCID: J1O\nData: 18/11/2026';

  it('mesma entrada, mesma saída (100 vezes), e sempre no schema', async () => {
    const p = new MockCertificateAiProvider('v1');
    const first = await p.analyze({ text, promptVersion: PROMPT_VERSION });
    for (let i = 0; i < 100; i += 1) expect(await p.analyze({ text, promptVersion: PROMPT_VERSION })).toBe(first);
    expect(() => parseAiOutput(first)).not.toThrow();
  });

  it('v1 e estrito diferem só onde devem (CRM sem UF)', () => {
    const noUf = 'Atesto 1 (um) dia a partir de 08/11/2026.\nDr. Paulo Lima\nCRM 778899\nData: 08/11/2026';
    const status = (m: 'v1' | 'estrito') => mockAnalysis(noUf, m).checkedFields.find((f) => f.item === 'profissional')!.status;
    expect(status('v1')).toBe('ok');
    expect(status('estrito')).toBe('incoerente');
  });
});

describe('provedor Anthropic (HTTP)', () => {
  it('chama a Messages API com structured outputs e devolve o texto', async () => {
    const f = fakeFetch(() => ({ json: { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(valid) }] } }));
    const p = new AnthropicCertificateAiProvider({ apiKey: 'chave-ficticia', model: 'claude-haiku-5-5', timeoutMs: 1000, fetch: f.fn });
    const raw = await p.analyze({ text: 'texto anonimizado', promptVersion: PROMPT_VERSION });
    expect(parseAiOutput(raw)).toEqual(valid);
    const call = f.calls[0]!;
    expect(call.url).toBe('https://api.anthropic.com/v1/messages');
    expect(call.headers).toMatchObject({ 'x-api-key': 'chave-ficticia', 'anthropic-version': ANTHROPIC_API_VERSION });
    expect(call.body).toMatchObject({ model: 'claude-haiku-5-5', output_config: { format: { type: 'json_schema' } } });
    expect(call.body).not.toHaveProperty('temperature');
    expect(call.body.messages).toEqual([{ role: 'user', content: '<atestado>\ntexto anonimizado\n</atestado>' }]);
  });

  it.each([
    ['HTTP 500', { status: 500, json: {} }, 'provedor_indisponivel'],
    ['recusa', { json: { stop_reason: 'refusal', content: [] } }, 'recusa_do_modelo'],
    ['cortada', { json: { stop_reason: 'max_tokens', content: [{ type: 'text', text: '{' }] } }, 'saida_truncada'],
    ['sem texto', { json: { stop_reason: 'end_turn', content: [] } }, 'saida_fora_do_schema'],
  ])('%s → %s', async (_l, response, code) => {
    const f = fakeFetch(() => response);
    const p = new AnthropicCertificateAiProvider({ apiKey: 'k', model: 'm', timeoutMs: 1000, fetch: f.fn });
    await expect(p.analyze({ text: 't', promptVersion: PROMPT_VERSION })).rejects.toMatchObject({ code });
  });

  it('tempo esgotado vira erro tratado', async () => {
    const slow: FetchLike = (_u, init) =>
      new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('x'), { name: 'TimeoutError' }))));
    const p = new AnthropicCertificateAiProvider({ apiKey: 'k', model: 'm', timeoutMs: 20, fetch: slow });
    await expect(p.analyze({ text: 't', promptVersion: PROMPT_VERSION })).rejects.toMatchObject({ code: 'tempo_esgotado' });
  });
});

describe('provedor OpenAI-compatível (HTTP, serve modelo local)', () => {
  it('usa response_format json_schema; sem chave não manda Authorization', async () => {
    const f = fakeFetch(() => ({ json: { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(valid) } }] } }));
    const p = new OpenAiCompatibleCertificateAiProvider({ baseUrl: 'http://ollama:11434/v1/', model: 'llama3.1:8b', timeoutMs: 1000, fetch: f.fn });
    expect(parseAiOutput(await p.analyze({ text: 't', promptVersion: PROMPT_VERSION }))).toEqual(valid);
    expect(f.calls[0]!.url).toBe('http://ollama:11434/v1/chat/completions');
    expect(f.calls[0]!.headers).not.toHaveProperty('authorization');
    expect(f.calls[0]!.body).toMatchObject({ temperature: 0, response_format: { type: 'json_schema', json_schema: { strict: true } } });
  });
});

describe('registro de provedores: sem configuração, mock com aviso', () => {
  it.each([
    ['nada configurado', MOCK_ONLY_CONFIG],
    ['anthropic sem chave', { ...MOCK_ONLY_CONFIG, provider: 'anthropic' as const, model: 'claude-haiku-5-5' }],
    ['openai sem URL', { ...MOCK_ONLY_CONFIG, provider: 'openai_compativel' as const, model: 'x' }],
    ['provedor sem modelo', { ...MOCK_ONLY_CONFIG, provider: 'anthropic' as const, anthropicApiKey: 'k' }],
  ])('%s → mock:v1 + IA_SIMULADA', (_l, cfg) => {
    const r = new CertificateAiRegistry(cfg).default();
    expect(r.provider.provider).toBe('mock');
    expect(r.warnings).toEqual(['IA_SIMULADA']);
  });

  it('com chave e modelo, usa o provedor real sem aviso', () => {
    const r = new CertificateAiRegistry({ ...MOCK_ONLY_CONFIG, provider: 'anthropic', model: 'claude-haiku-5-5', anthropicApiKey: 'k' }).default();
    expect(r.provider).toMatchObject({ provider: 'anthropic', model: 'claude-haiku-5-5' });
    expect(r.warnings).toEqual([]);
  });

  it('especificação provedor:modelo', () => {
    expect(parseModelSpec('openai_compativel:llama3.1:8b')).toEqual({ provider: 'openai_compativel', model: 'llama3.1:8b' });
    expect(() => parseModelSpec('gpt')).toThrow();
    const reg = new CertificateAiRegistry(MOCK_ONLY_CONFIG);
    expect(reg.resolve('mock:estrito').provider.model).toBe('estrito');
    expect(() => reg.resolve('mock:nao-existe')).toThrow();
    expect(() => reg.resolve('anthropic:claude-haiku-5-5')).toThrow(/API_KEY/);
  });
});
