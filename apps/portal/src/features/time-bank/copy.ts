/** Textos do banco de horas do RH. */

export const COPY = {
  title: 'Banco de horas',
  subtitle: 'Saldo e vencimentos por colaborador',
  pickEstablishmentTitle: 'Escolha um estabelecimento',
  pickEstablishmentText: 'O banco de horas é mostrado por estabelecimento. Use o seletor no menu lateral.',
  searchLabel: 'Buscar colaborador por nome ou matrícula',
  emptySearchText: 'Confira a grafia ou busque pela matrícula. Limpe o campo para ver todos.',
  emptyTitle: 'Nenhum saldo para mostrar',
  emptyText: 'Nenhum colaborador deste estabelecimento tem lançamentos no banco de horas.',
  compensatory: 'Lançar folga compensatória',
  compensatoryPending: 'O lançamento de folga compensatória ainda não está disponível no servidor.',

  policyTitle: 'Regra do banco de horas',
  policyWhat: 'a regra do banco de horas',
  policyMissingTitle: 'Este estabelecimento não tem regra do banco de horas',
  policyMissingText: 'Sem regra, nada é lançado no banco de horas.',
  policyAskRh: 'A regra é cadastrada pelo RH.',
  policyDefine: 'Definir regra',
  policyChange: 'Alterar regra',
  policyModality: 'Modalidade',
  policySundayWeight: 'Peso do domingo',
  policyHolidayWeight: 'Peso do feriado',
  policyValidity: 'Vigência',
  policyRecalcNote: 'Dias já apurados só entram no banco quando são recalculados, em Escala e apuração.',

  formDescription: 'A regra vale para o estabelecimento, a partir da data de início.',
  formWeightHint: 'De 1,00 a 9,99. Com 1,00, cada minuto vale um minuto de crédito.',
  formValidFrom: 'Início da vigência',
  formValidFromFirstHint: 'Antes desta data nada é lançado.',
  formValidFromHint: 'A mesma data corrige a regra registrada. Uma data posterior encerra a anterior no dia anterior.',
  formCancel: 'Cancelar',
  formSave: 'Salvar regra',
  saved: 'Regra do banco de horas salva',
  errorModality: 'Escolha a modalidade.',
  errorWeight: 'Informe um peso de 1,00 a 9,99.',
  errorValidFrom: 'Informe o início da vigência.',
  errorValidity: 'A data de início é anterior à da regra já registrada. Use a mesma data para corrigi-la ou uma data posterior para trocá-la.',
} as const;

export const policyStartsLater = (date: string) => `A regra começa em ${date}`;
export const policyValidity = (from: string, to: string | null) => (to ? `De ${from} a ${to}` : `Desde ${from}, sem data de fim`);

/** "2.00" (api) → "2,00" (tela). */
export const formatWeight = (weight: string) => weight.replace('.', ',');

/** Tipos de lançamento do banco de horas (CHECK bh_tipo do back). Valor desconhecido aparece como veio. */
const ENTRY_TYPE: Record<string, string> = {
  credito: 'Crédito',
  debito: 'Débito',
  folga_compensatoria: 'Folga compensatória',
  pagamento: 'Pagamento',
  desconto: 'Desconto',
  expiracao: 'Expiração',
};
export const entryLabel = (t: string) => ENTRY_TYPE[t] ?? t;
