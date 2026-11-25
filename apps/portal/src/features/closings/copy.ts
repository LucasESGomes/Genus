/** Textos da tela de fechamento. Rótulos de enumeração do back ficam em lib/labels. */

export const COPY = {
  title: 'Fechamento',
  subtitle: 'Competências do estabelecimento: abrir, fechar, emitir espelhos e reabrir',
  open: 'Abrir competência',
  pickEstablishmentTitle: 'Escolha um estabelecimento',
  pickEstablishmentText: 'O fechamento é de um estabelecimento por vez. Use o seletor no menu lateral.',
  emptyTitle: 'Nenhuma competência aberta ainda',
  emptyText: 'Abra a competência do mês para poder fechá-la e emitir os espelhos dos colaboradores.',
  readOnly: 'Seu perfil só consulta o fechamento. Abrir, fechar e reabrir são do RH.',
  exportAej: 'Exportar AEJ (Fase 2)',
  exportAejNote: 'A exportação do AEJ e da folha fica para a Fase 2.',
  pdfPending: 'O PDF assinado ainda não está disponível: o serviço de assinatura não devolve o endereço do arquivo (pdfUrl).',
  mirrorsHint: 'Os espelhos são emitidos pelo RH depois do fechamento, em “Gerar espelhos”.',
  noAcknowledgement: 'Sem ciência',
  blockedTitle: 'Não foi possível fechar a competência',
  blockedHelp: 'Resolva o que está pendente e tente fechar de novo.',
  reopenWarning: 'Reabrir apaga a ciência dos espelhos já dados e fica registrado na auditoria.',
} as const;

export const closeDialog = (month: string) => ({
  title: `Fechar ${month}?`,
  description:
    'Fechar trava o período: depois disso nenhum ajuste, justificativa ou abono entra nele sem reabrir a competência. ' +
    'O fechamento só é aceito sem inconsistências abertas nem ajustes pendentes.',
  confirmLabel: 'Fechar competência',
});

export const reopenDialog = (month: string) => ({
  title: `Reabrir ${month}?`,
  description: `${COPY.reopenWarning} Informe o motivo e digite a competência para confirmar.`,
  confirmLabel: 'Reabrir competência',
});
