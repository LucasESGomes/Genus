/**
 * Tradução das regras do banco para códigos de domínio estáveis.
 *
 * Boa parte das regras do RH mora no Postgres (EXCLUDE, UNIQUE, CHECK e
 * triggers). Quando o banco recusa, a api responde com o código da regra, e
 * não 500. A mensagem é fixa: nunca repete o texto do banco, que pode citar
 * ids, datas ou valores.
 *
 * Constraint com nome (UNIQUE, EXCLUDE, CHECK): pelo nome. Trigger (sem nome de
 * constraint): pelo começo da mensagem do `RAISE EXCEPTION` das migrations
 * 0002 e 0005.
 */
import type { ErrorCode } from './contracts';
import type { RhDomainErrorCode } from '../modules/rules-common/rules/errors';

export interface MappedError {
  status: number;
  code: ErrorCode;
  message: string;
}

const conflict = (code: ErrorCode, message: string): MappedError => ({ status: 409, code, message });

/** Nome da constraint → resposta. */
export const CONSTRAINT_ERRORS: Readonly<Record<string, MappedError>> = {
  colaborador_cpf_unico: conflict('CPF_DUPLICADO', 'Já existe um colaborador com esse CPF nesta conta'),
  colab_matricula_unica: conflict('MATRICULA_DUPLICADA', 'Já existe um colaborador com essa matrícula no estabelecimento'),
  vinculo_sem_sobreposicao: conflict('VINCULO_SOBREPOSTO', 'O vínculo se sobrepõe a outro vínculo do colaborador'),
  colab_escala_sem_sobreposicao: conflict('ESCALA_SOBREPOSTA', 'A escala se sobrepõe a outra escala do colaborador'),
  afast_sem_sobreposicao: conflict('AFASTAMENTO_SOBREPOSTO', 'O afastamento se sobrepõe a outro do colaborador'),
  afastamento_atestado_id_key: conflict('AFASTAMENTO_SOBREPOSTO', 'Esse atestado já gerou um afastamento'),
  pa_sem_sobreposicao: conflict('PERIODO_AQUISITIVO_SOBREPOSTO', 'O período aquisitivo se sobrepõe a outro do colaborador'),
  fg_pessoa_sem_sobreposicao: conflict('FERIAS_SOBREPOSTAS', 'As férias se sobrepõem a outras férias aprovadas do colaborador'),
  atestado_arquivo_unico: conflict('ATESTADO_DUPLICADO', 'Esse arquivo de atestado já foi enviado'),
  ajuste_decisor_diferente: conflict('DECISOR_IGUAL_SOLICITANTE', 'Quem fez o pedido não pode decidir sobre ele'),
  fg_decisor_diferente: conflict('DECISOR_IGUAL_SOLICITANTE', 'Quem fez o pedido não pode decidir sobre ele'),
  fech_unico: conflict('FECHAMENTO_DUPLICADO', 'Essa competência já existe para o estabelecimento'),
  aparelho_nome_unico: conflict('APARELHO_NOME_DUPLICADO', 'Já existe um aparelho com esse nome no estabelecimento'),
  uq_sessao_calibracao_aberta: conflict('CALIBRACAO_EM_ANDAMENTO', 'Já existe uma calibração em andamento neste aparelho'),
  pa_direito_bate_faltas: conflict('PARAMETRO_INVALIDO', 'Os dias de direito não batem com as faltas do período'),
};

/** Começo da mensagem do trigger → resposta. */
const TRIGGER_ERRORS: readonly { prefix: RegExp; error: MappedError }[] = [
  { prefix: /^Período fechado em /, error: conflict('PERIODO_FECHADO', 'O período está fechado: reabra antes de alterar') },
  { prefix: /^Setor .* ficaria desfalcado/, error: conflict('FERIAS_SETOR_DESFALCADO', 'O setor ficaria desfalcado nesse intervalo') },
  { prefix: /^Férias em no máximo /, error: conflict('FERIAS_FRACIONAMENTO_INVALIDO', 'Férias em no máximo 3 períodos') },
  { prefix: /^Um dos períodos precisa ter /, error: conflict('FERIAS_FRACIONAMENTO_INVALIDO', 'Um dos períodos de férias precisa ter 14 dias ou mais') },
  { prefix: /^Dias solicitados /, error: conflict('FERIAS_SALDO_INSUFICIENTE', 'Os dias pedidos passam do direito do período aquisitivo') },
  { prefix: /^Abono pecuniário limitado /, error: conflict('FERIAS_ABONO_ACIMA_LIMITE', 'O abono passa de 1/3 do direito') },
  { prefix: /^Férias não podem começar /, error: conflict('FERIAS_INICIO_VEDADO', 'As férias não podem começar nessa data') },
  { prefix: /^Consentimento biométrico .* revogado/, error: conflict('CONSENTIMENTO_AUSENTE', 'O consentimento biométrico foi revogado') },
  { prefix: /^O embedding precisa da DEK /, error: conflict('CHAVE_EMPRESA_AUSENTE', 'A chave da empresa do colaborador não confere') },
];

export function mapDatabaseRule(constraint: string | undefined, message: string): MappedError | undefined {
  if (constraint && CONSTRAINT_ERRORS[constraint]) return CONSTRAINT_ERRORS[constraint];
  return TRIGGER_ERRORS.find((t) => t.prefix.test(message))?.error;
}

/** Status HTTP de um `RhDomainError` das regras puras. */
export function domainErrorStatus(code: RhDomainErrorCode): number {
  if (code === 'DATA_INVALIDA' || code === 'PIN_FORMATO_INVALIDO' || code === 'PIN_FRACO') return 400;
  if (code.startsWith('PARAMETRO_') || code === 'PIN_HASH_INVALIDO' || code === 'PIN_PEPPER_INVALIDO') return 422;
  return 409;
}
