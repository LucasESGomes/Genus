/** Textos da tela de atestados (pt-BR). Rótulos de enumeração vêm de lib/labels. */
export const COPY = {
  title: 'Atestados',
  subtitle: 'Fila de atestados recebidos, análise indicativa e decisão do RH',
  searchLabel: 'Buscar atestado por nome ou matrícula do colaborador',
  emptySearchText: 'Confira a grafia ou busque pela matrícula. Limpe o campo para ver a fila inteira.',
  nextInQueue: 'Abrir próximo da fila',
  queueLabel: 'Fila de atestados',
  detailLabel: 'Detalhe do atestado',
  pickOne: 'Selecione um atestado na fila para ver os detalhes.',
  restricted: 'Dado sensível restrito',
  fileRestrictedTitle: 'Arquivo restrito ao RH',
  fileRestrictedText: 'Seu perfil não acessa documentos médicos.',
  openFile: 'Ver arquivo do atestado',
  waitingRh: 'Aguardando decisão do RH',
  approveHint: 'Aprovar registra o afastamento e recalcula os dias. A marcação original não é alterada.',
  analysisTitle: 'Análise do atestado',
  analysisHint: 'A análise só sugere: ela não altera o status do atestado nem comprova a autenticidade do documento. A decisão é do RH.',
  reading: 'Lendo atestado…',
  readingHint: 'A leitura automática pode levar alguns instantes. O resultado aparece aqui ao terminar.',
  aiFailed: 'A leitura por IA falhou. Exibindo só o resultado das regras.',
  textLabel: 'Texto do atestado (colado ou digitado)',
  textHint: 'O texto fica só nesta tela, na memória, e some ao fechar o painel ou trocar de atestado.',
  modelsLabel: 'Modelos para comparar (opcional)',
  analyze: 'Analisar com IA',
  stageNote: 'Etapa na fila (derivada): ',
} as const;

export const WARNING_TEXT: Record<string, string> = {
  IA_SIMULADA: 'IA simulada: nenhum provedor real está configurado neste ambiente.',
};

export const MIN_TEXT = 20;
export const MAX_MODELS = 4;
