/** Textos da visão geral (pt-BR). */
import type { OverviewAlertTarget } from '@/lib/api/contracts';

export const COPY = {
  title: 'Visão geral',
  primary: 'Revisar inconsistências',
  alertsTitle: 'Alertas',
  alertsNone: 'Nada pendente neste período.',
  hoursTitle: 'Horas por dia',
  hoursHint: 'Soma do estabelecimento, em horas. A hora extra está contida no total trabalhado.',
  worked: 'Trabalhadas',
  overtime: 'Extras',
  issuesTitle: 'Faltas e inconsistências por dia',
  issuesHint: 'Dias de colaborador',
  absences: 'Faltas',
  inconsistent: 'Inconsistentes',
  statusTitle: 'Situação dos dias apurados',
  statusOk: 'Calculados',
  statusInconsistent: 'Inconsistentes',
  statusAbsent: 'Faltas',
  topTitle: 'Mais horas extras no período',
  topNone: 'Ninguém fez hora extra no período.',
  table: 'Ver como tabela',
  emptyTitle: 'Ainda não há dias apurados neste período',
} as const;

/** Destino de cada alerta, por `target` (a rota e o filtro são do front; o texto do alerta vem da api). */
export const ALERT_ROUTE: Record<OverviewAlertTarget, string> = {
  apuracao: '/rh/apuracao?aba=inconsistente',
  escalas: '/rh/escalas',
  colaboradores: '/rh/colaboradores',
  ajustes: '/rh/ajustes',
  atestados: '/rh/atestados',
  'banco-horas': '/rh/banco-horas',
};
