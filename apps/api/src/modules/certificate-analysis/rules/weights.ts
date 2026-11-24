/**
 * Pesos e limiares da análise de atestado, versionados (RF67). Mudar um número
 * aqui exige subir `RULES_VERSION`: a versão vai gravada em cada análise.
 *
 * Os limiares de `nivel_risco` e das faixas de confiabilidade são provisórios:
 * 04 G6 diz que ficam [A DEFINIR] com dados reais.
 */

export const RULES_VERSION = 'regras-atestado-2026-11-24';

/** Peso de cada achado das regras na nota de risco (0 a 100, soma limitada a 100). */
export const RISK_WEIGHTS = {
  atestado_duplicado: 60,
  datas_divergentes: 25,
  crm_invalido: 20,
  enviado_fora_do_prazo: 15,
  dados_pessoais_no_texto: 0,
} as const;

export type FindingCode = keyof typeof RISK_WEIGHTS;

/** Nota de risco → nível (CHECK analise_nota). */
export const RISK_LEVELS = { alto: 60, medio: 30 } as const;

/** Desconto na confiabilidade por campo verificado pela IA. */
export const FIELD_PENALTIES = { ok: 0, ausente: 15, incoerente: 20, ilegivel: 15 } as const;

/**
 * Teto da confiabilidade: o sistema nunca diz que o atestado é 100% verdadeiro.
 * Só confere completude e coerência do texto; autenticidade quem confirma é o RH
 * (e, se preciso, o médico ou o CRM). [A CONFIRMAR] o valor com o RH.
 */
export const RELIABILITY_CAP = 90;

/** Sem a verificação da IA (barrada pelas regras ou com falha), a confiabilidade fica no máximo aqui. */
export const RELIABILITY_CAP_WITHOUT_AI = 50;

export const RELIABILITY_BANDS = { alta: 70, media: 40 } as const;

/** Aviso que acompanha TODA análise (API, banco e relatório). */
export const ANALYSIS_NOTICE =
  'Análise automática e indicativa: confere só a completude e a coerência do texto do atestado. ' +
  'Não comprova a autenticidade do documento nem substitui a decisão do RH.';
