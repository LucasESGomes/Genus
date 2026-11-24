/**
 * Erros de domínio das regras de RH. O `code` é estável (a API e os testes
 * dependem dele); a mensagem é em pt-BR e nunca leva CPF, CID nem salário.
 */
export const RH_DOMAIN_ERROR_CODES = [
  'DATA_INVALIDA',
  'PARAMETRO_AUSENTE',
  'PARAMETRO_AMBIGUO',
  'PARAMETRO_INVALIDO',
  'FERIAS_PERIODO_INVALIDO',
  'FERIAS_PERIODO_CURTO',
  'FERIAS_FRACIONAMENTO_INVALIDO',
  'FERIAS_SALDO_INSUFICIENTE',
  'FERIAS_ABONO_ACIMA_LIMITE',
  'FERIAS_INICIO_VEDADO',
  'FERIAS_AVISO_INSUFICIENTE',
  'FERIAS_SOBREPOSTAS',
  'FERIAS_SETOR_DESFALCADO',
  'BANCO_SALDO_NEGATIVO_EXCEDIDO',
  'PIN_FORMATO_INVALIDO',
  'PIN_HASH_INVALIDO',
  'PIN_FRACO',
  'PIN_PEPPER_INVALIDO',
] as const;

export type RhDomainErrorCode = (typeof RH_DOMAIN_ERROR_CODES)[number];

export type RhErrorDetails = Readonly<Record<string, string | number | boolean | null>>;

export class RhDomainError extends Error {
  override readonly name = 'RhDomainError';

  constructor(
    readonly code: RhDomainErrorCode,
    message: string,
    readonly details: RhErrorDetails = {},
  ) {
    super(message);
  }
}
