/** Textos da tela de ajustes (pt-BR). Rótulos de enumeração vêm de lib/labels. */
export const COPY = {
  title: 'Ajustes',
  subtitle: 'Pedidos de inclusão de batida, justificativa e abono, e a decisão do RH',
  newAdjustment: 'Novo ajuste',
  tabsLabel: 'Situação dos ajustes',
  tableCaption: 'Ajustes de marcação',
  filterEmployee: 'Colaborador',
  allEmployees: 'Todos os colaboradores',
  searchLabel: 'Buscar ajuste por nome ou matrícula do colaborador',
  emptySearchText: 'Confira a grafia ou busque pela matrícula. Limpe o campo para ver todos.',
  filteredBy: 'Filtrando por colaborador',
  clearFilter: 'Limpar filtro',
  originalTitle: 'Marcação original',
  originalHint: 'Somente leitura. É o que o colaborador registrou no ponto.',
  proposalTitle: 'Proposta',
  proposalAdds: 'Acrescenta ao dia, sem substituir a original.',
  neverChanges:
    'Aprovar acrescenta a proposta à apuração do dia. A marcação original nunca é alterada nem apagada (Portaria MTP 671/2021).',
  abonoRhOnly: 'Abono: decisão do RH',
  readOnly: 'Seu perfil só consulta ajustes.',
  approve: 'Aprovar',
  reject: 'Recusar',
  approveTitle: 'Aprovar ajuste',
  rejectTitle: 'Recusar ajuste',
  approveNote: 'Observação (opcional)',
  rejectReason: 'Motivo da recusa',
  decidedBy: 'Decisão',
  alreadyDecided: 'Este ajuste já foi decidido por outra pessoa. A lista foi atualizada.',
  empty: {
    pendente: { title: 'Nenhum ajuste pendente', text: 'Todos os pedidos já foram decididos.' },
    aprovado: { title: 'Nenhum ajuste aprovado', text: 'Os ajustes aprovados aparecem aqui.' },
    recusado: { title: 'Nenhum ajuste recusado', text: 'Os ajustes recusados aparecem aqui.' },
    todos: { title: 'Nenhum ajuste registrado', text: 'Os pedidos do colaborador e os ajustes lançados pelo RH aparecem aqui.' },
  },
} as const;

export const TAB_LABEL = { pendente: 'Pendentes', aprovado: 'Aprovados', recusado: 'Recusados', todos: 'Todos' } as const;
