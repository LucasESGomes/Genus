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
  compensatoryPending: 'O back ainda não tem a política do banco nem a folga compensatória para o RH.',
} as const;

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
