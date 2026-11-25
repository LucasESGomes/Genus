/** Textos da visão geral (pt-BR). */
export const COPY = {
  title: 'Visão geral',
  primary: 'Revisar inconsistências',
  alertsTitle: 'Alertas de inconsistência',
  chartTitle: 'Horas extras por dia',
  chartHint: 'Soma de todos os colaboradores do estabelecimento, em horas',
  chartUnavailable: 'Gráfico indisponível: aguardando o back',
  chartUnavailableText: 'A api ainda não entrega a série diária de horas extras. O front não calcula esse valor.',
} as const;

/** Destino de cada alerta, por `target` (a rota e o filtro são do front; o texto do alerta vem da api). */
export const ALERT_ROUTE = {
  apuracao: '/rh/apuracao?aba=inconsistente',
  escalas: '/rh/escalas?aviso=carga_semanal_acima_limite',
} as const;
