import type { ReportType } from '@/lib/api/contracts';

/** [SEM DESIGN] Textos da prévia de relatórios (RF58). */
export const COPY = {
  title: 'Relatórios',
  subtitle: 'Prévia · a geração depende do servidor',
  noticeTitle: 'Prévia: relatórios ainda não são gerados',
  noticeText: 'Esta tela mostra como o pedido de relatório vai funcionar. O servidor ainda não tem a geração, então nenhum arquivo é criado e o botão fica desabilitado.',
  pickTitle: 'Escolha o relatório',
  generate: 'Gerar relatório',
  generatePending: 'Aguardando back: geração de relatórios',
  allDepartments: 'Todos os setores',
  departmentNeedsEstablishment: 'Escolha um estabelecimento no menu lateral para filtrar por setor.',
} as const;

export const REPORT_DESCRIPTION: Record<ReportType, string> = {
  horas_extras: 'Horas extras por colaborador e por dia, como apuradas pelo servidor.',
  faltas: 'Faltas e ausências do período, com a justificativa quando houver.',
  banco_horas: 'Saldo, lançamentos e vencimentos do banco de horas.',
  ferias: 'Férias aprovadas, solicitadas e em curso no período.',
  afastamentos: 'Afastamentos do período, sem diagnóstico (dado de saúde fica restrito ao RH).',
};
