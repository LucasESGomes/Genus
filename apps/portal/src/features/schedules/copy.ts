/** Textos das telas de escalas (pt-BR). */
export const COPY = {
  title: 'Escalas',
  subtitle: 'Jornadas previstas por estabelecimento. A escala orienta a apuração e nunca altera uma marcação.',
  newSchedule: 'Nova escala',
  assign: 'Atribuir escala',
  tableCaption: 'Escalas do estabelecimento',
  searchLabel: 'Buscar escala pelo nome',
  emptySearchText: 'Confira a grafia. Limpe o campo para ver todas as escalas.',
  filterLabel: 'Filtrar escalas por aviso',
  warningsNote: 'Os avisos só sinalizam e nunca impedem salvar nem usar a escala (art. 74 da Portaria 671).',
  empty: { title: 'Nenhuma escala', text: 'Cadastre a primeira escala para o RH poder atribuí-la aos colaboradores.' },
  emptyFilter: { title: 'Nenhuma escala com este aviso', text: 'Nenhuma escala do estabelecimento tem esse aviso hoje.' },
  readOnlyTypeHint: 'Tipo e ciclo não mudam depois de criar a escala. Para mudar, crie outra.',
} as const;

export const WARNING_FILTERS = ['todas', 'carga_semanal_acima_limite', 'folgas_abaixo_minimo'] as const;
export type WarningFilter = (typeof WARNING_FILTERS)[number];
