/** Dados de exemplo copiados do design (Genus_ interface RH e portal/*.dc.html), só como fonte para os mocks. Não usar direto nas telas: cada módulo converte para o contrato em lib/api/mocks/<modulo>.ts. */


/** Genus RH.dc.html: NAV (itens da navegação lateral). */
export const designNav = [
  { id: 'geral', label: 'Visão geral', icon: 'ph-squares-four', tela: 'geral' },
  { id: 'colab', label: 'Colaboradores', icon: 'ph-users', tela: 'espelho' },
  { id: 'escala', label: 'Escala e apuração', icon: 'ph-calendar-check', tela: 'apuracao' },
  { id: 'ajustes', label: 'Ajustes', icon: 'ph-pencil-simple-line' },
  { id: 'ferias', label: 'Férias', icon: 'ph-sun-horizon', tela: 'ferias' },
  { id: 'atest', label: 'Atestados', icon: 'ph-first-aid-kit', tela: 'atestados' },
  { id: 'banco', label: 'Banco de horas', icon: 'ph-hourglass-medium' },
  { id: 'fech', label: 'Fechamento', icon: 'ph-lock-simple' },
  { id: 'rel', label: 'Relatórios', icon: 'ph-chart-bar' },
  { id: 'conf', label: 'Configurações', icon: 'ph-gear-six' },
] as const;

/** Genus RH.dc.html: TELA_NAV (tela -> item de navegação ativo). */
export const designTelaNav = {
  geral: 'geral',
  espelho: 'colab',
  apuracao: 'escala',
  ferias: 'ferias',
  atestados: 'atest',
} as const;

/** Genus RH.dc.html: ESTABS (estabelecimentos do seletor). */
export const designEstablishments = [
  { nome: 'Fazenda Santa Helena', sub: 'CAEPF · Rio Verde/GO' },
  { nome: 'Usina Boa Vista', sub: 'CNPJ · Quirinópolis/GO' },
  { nome: 'Granja São José', sub: 'CNPJ · Chapecó/SC' },
] as const;

/** Genus RH.dc.html: PER (período) e TZ (fuso exibido após o período). */
export const designPeriod = {
  periodo: '1 a 21 de novembro de 2026',
  periodoCurto: '1 a 21 nov. 2026',
  fuso: ' · America/Sao_Paulo',
} as const;

/** Genus RH.dc.html: DOW (abreviações dos dias da semana, a partir de domingo). */
export const designWeekdays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'] as const;

/** Genus RH.dc.html: ST (status da apuração do dia). */
export const designDayStatus = {
  calculada: { icon: 'ph-check-circle', color: '#102C50', label: 'Calculada' },
  inconsistente: { icon: 'ph-warning', color: '#8A5A12', label: 'Inconsistente' },
  falta: { icon: 'ph-minus-circle', color: '#8A5A12', label: 'Falta' },
  abonado: { icon: 'ph-first-aid-kit', color: '#5A6675', label: 'Atestado' },
  folga: { icon: 'ph-moon', color: '#5A6675', label: 'Folga' },
  feriado: { icon: 'ph-flag', color: '#5A6675', label: 'Feriado' },
  ajustada: { icon: 'ph-check-circle', color: '#102C50', label: 'Calculada' },
} as const;

/**
 * Genus RH.dc.html: APUR (apuração do dia, 21/11/2026, 10 colaboradores).
 * `trab`, `extra` e `falta` são o resultado de calcRow() e da formatação fmt() para cada linha
 * ('—' quando não se aplica). Calculados à mão a partir de `marc` e `prev`; conferidos na linha.
 */
export const designDayRows = [
  { nome: 'Antônio Carlos Ferreira', mat: '00412', setor: 'Colheita', marc: ['06:58', '11:02', '12:01', '15:20'], prev: '07:20', st: 'calculada', motivo: 'Escala 6x1', cargo: 'Operador de colhedora', trab: '07:23', extra: '—', falta: '—' },
  { nome: 'Maria Aparecida Souza', mat: '00418', setor: 'Ordenha', marc: ['04:02', '08:00', '09:01', '12:24'], prev: '07:20', st: 'calculada', motivo: 'Escala 6x1', cargo: 'Ordenhadora', trab: '07:21', extra: '—', falta: '—' },
  { nome: 'José Roberto Lima', mat: '00433', setor: 'Colheita', marc: ['06:55', '11:00', '12:02'], prev: '07:20', st: 'inconsistente', motivo: 'Marcações ímpares', cargo: 'Trabalhador rural', trab: '04:05', extra: '—', falta: '—' },
  { nome: 'Luciana Pereira Alves', mat: '00451', setor: 'Agroindústria', marc: ['05:58', '10:00', '10:35', '13:40'], prev: '07:20', st: 'inconsistente', motivo: 'Intervalo de 35 min, mínimo 60', cargo: 'Auxiliar de produção', trab: '07:07', extra: '—', falta: '00:13' },
  { nome: 'Francisco das Chagas Silva', mat: '00467', setor: 'Manutenção', marc: [], prev: '07:20', st: 'falta', motivo: 'Sem marcações no dia', cargo: 'Mecânico', trab: '—', extra: '—', falta: '07:20' },
  { nome: 'Rita de Cássia Moura', mat: '00472', setor: 'Ordenha', marc: [], prev: '07:20', st: 'abonado', motivo: 'Atestado em análise', cargo: 'Ordenhadora', trab: '—', extra: '—', falta: '—' },
  { nome: 'Edson Barbosa Nunes', mat: '00488', setor: 'Colheita', marc: ['06:50', '11:05', '12:00', '18:42'], prev: '07:20', st: 'inconsistente', motivo: 'Extras acima de 2 h', cargo: 'Tratorista', trab: '10:57', extra: '03:37', falta: '—' },
  { nome: 'Cláudia Regina Teixeira', mat: '00490', setor: 'Administrativo', marc: [], prev: '—', st: 'folga', motivo: 'Escala 5x2', cargo: 'Assistente administrativa', trab: '—', extra: '—', falta: '—' },
  { nome: 'Valdir Antunes Rocha', mat: '00502', setor: 'Manutenção', marc: ['07:00', '11:00', '12:00', '15:21'], prev: '07:20', st: 'inconsistente', motivo: 'Interjornada de 9 h 40 min', cargo: 'Eletricista', trab: '07:21', extra: '—', falta: '—' },
  { nome: 'Paulo Henrique Dias', mat: '00515', setor: 'Colheita', marc: ['06:45', '11:00', '12:00', '15:08'], prev: '07:20', st: 'calculada', motivo: 'Escala 6x1', cargo: 'Trabalhador rural', trab: '07:23', extra: '—', falta: '—' },
] as const;

/** Genus RH.dc.html: abas de filtro da apuração (tabDefs). */
export const designDayFilters = [
  { id: 'todos', label: 'Todos' },
  { id: 'inconsistente', label: 'Inconsistentes' },
  { id: 'falta', label: 'Faltas' },
  { id: 'calculada', label: 'Calculadas' },
] as const;

/** Genus RH.dc.html: setores do filtro da apuração (setores). */
export const designDaySectors = ['Todos os setores', 'Colheita', 'Ordenha', 'Agroindústria', 'Manutenção', 'Administrativo'] as const;

/**
 * Genus RH.dc.html: SETORES_FER (férias por setor). `limite` é o máximo de pessoas em férias
 * simultâneas; `total` é o total de colaboradores do setor. Dias são do mês de dezembro.
 */
export const designVacationSectors = {
  Ordenha: {
    limite: 3,
    total: 12,
    rows: [
      { nome: 'Maria Aparecida Souza', ini: 1, fim: 20, st: 'aprovado' },
      { nome: 'Rita de Cássia Moura', ini: 8, fim: 19, st: 'aprovado' },
      { nome: 'Joaquim Mendes', ini: 14, fim: 28, st: 'aprovado' },
      { nome: 'Joana Ribeiro', ini: 15, fim: 19, st: 'recusado', quando: '18/11 por Lúcia Martins' },
      { nome: 'Sebastião Prado', ini: 21, fim: 31, st: 'aprovado' },
      { nome: 'Daniela Costa', ini: 29, fim: 31, st: 'pendente' },
    ],
  },
  Colheita: {
    limite: 5,
    total: 38,
    rows: [
      { nome: 'Edson Barbosa Nunes', ini: 1, fim: 10, st: 'aprovado' },
      { nome: 'Paulo Henrique Dias', ini: 14, fim: 23, st: 'pendente' },
      { nome: 'Antônio Carlos Ferreira', ini: 21, fim: 31, st: 'aprovado' },
      { nome: 'José Roberto Lima', ini: 28, fim: 31, st: 'aprovado' },
    ],
  },
  Agroindústria: {
    limite: 2,
    total: 9,
    rows: [
      { nome: 'Luciana Pereira Alves', ini: 7, fim: 16, st: 'aprovado' },
      { nome: 'Marcos Vinícius Rocha', ini: 10, fim: 19, st: 'aprovado' },
      { nome: 'Tereza Gomes', ini: 15, fim: 24, st: 'pendente' },
    ],
  },
} as const;

/** Genus RH.dc.html: AT (fila de atestados). `campos` e `cid` são nulos quando o atestado ainda está sendo lido. */
export const designCertificates = [
  {
    id: 1, nome: 'Rita de Cássia Moura', mat: '00472', setor: 'Ordenha', enviado: '21/11 às 08:14', periodo: '20 e 21/11', dias: 2, st: 'analise', risco: 'medio', nota: 46, arquivo: 'atestado_20-11.jpg',
    campos: [
      ['Paciente', 'Rita de Cássia Moura', 'ok', 'Igual ao cadastro'],
      ['Data de emissão', '20/11/2026', 'ok', ''],
      ['Afastamento', '2 dias, 20 e 21/11', 'ok', 'Igual ao informado'],
      ['Médico', 'Henrique Vasconcelos', 'ok', ''],
      ['CRM', 'CRM-GO 18.442', 'ok', 'Formato válido'],
      ['Assinatura', 'Detectada', 'ok', 'Carimbo e assinatura'],
    ],
    cid: 'J11',
    achados: [
      { sev: 'alerta', t: 'Recorrência em sextas-feiras', d: '3 afastamentos em sextas ou vésperas de feriado nos últimos 90 dias.' },
      { sev: 'sinal', t: 'Enviado no prazo', d: 'Recebido 1 dia após a emissão. O prazo da empresa é de 2 dias.' },
    ],
  },
  {
    id: 2, nome: 'Edson Barbosa Nunes', mat: '00488', setor: 'Colheita', enviado: '21/11 às 07:40', periodo: '21/11', dias: 1, st: 'recebido', risco: null, nota: null, arquivo: 'IMG_2031.jpg', campos: null, cid: null, achados: [],
  },
  {
    id: 3, nome: 'Luciana Pereira Alves', mat: '00451', setor: 'Agroindústria', enviado: '20/11 às 17:02', periodo: '18 a 20/11', dias: 3, st: 'recebido', risco: 'baixo', nota: 12, arquivo: 'atestado_luciana.pdf',
    campos: [
      ['Paciente', 'Luciana Pereira Alves', 'ok', 'Igual ao cadastro'],
      ['Data de emissão', '18/11/2026', 'ok', ''],
      ['Afastamento', '3 dias, 18 a 20/11', 'ok', 'Igual ao informado'],
      ['Médico', 'Carla Menezes', 'ok', ''],
      ['CRM', 'CRM-GO 22.910', 'ok', 'Formato válido'],
      ['Assinatura', 'Detectada', 'ok', ''],
    ],
    cid: 'M54.5',
    achados: [
      { sev: 'sinal', t: 'Sem pontos de atenção', d: 'Todos os campos conferem com o cadastro e com a ausência declarada.' },
    ],
  },
  {
    id: 4, nome: 'Francisco das Chagas Silva', mat: '00467', setor: 'Manutenção', enviado: '19/11 às 21:47', periodo: '14/11', dias: 1, st: 'analise', risco: 'alto', nota: 81, arquivo: 'foto_atestado.jpg',
    campos: [
      ['Paciente', 'Francisco C. Silva', 'warn', 'Nome abreviado; confira'],
      ['Data de emissão', '14/11/2026', 'ok', ''],
      ['Afastamento', '1 dia, 14/11', 'ok', ''],
      ['Médico', 'Ilegível', 'warn', 'Leitura fraca'],
      ['CRM', 'CRM 4471', 'warn', 'Sem UF; formato inválido'],
      ['Assinatura', 'Não detectada', 'warn', ''],
    ],
    cid: 'R51',
    achados: [
      { sev: 'alerta', t: 'Enviado fora do prazo', d: 'Recebido 5 dias após a emissão. O prazo da empresa é de 2 dias.' },
      { sev: 'alerta', t: 'Imagem semelhante a envio anterior', d: 'Parecida com o atestado enviado em 02/10/2026 (hash perceptual).' },
      { sev: 'alerta', t: 'CRM em formato inválido', d: 'Não foi possível identificar a UF do CRM. Não há consulta a base externa.' },
    ],
  },
  {
    id: 5, nome: 'Joaquim Mendes', mat: '00436', setor: 'Ordenha', enviado: '12/11 às 09:20', periodo: '10 a 14/11', dias: 5, st: 'aprovado', risco: 'baixo', nota: 8, arquivo: 'atestado_joaquim.pdf', decisao: 'Aprovado em 12/11 por Lúcia Martins',
    campos: [
      ['Paciente', 'Joaquim Mendes', 'ok', 'Igual ao cadastro'],
      ['Data de emissão', '10/11/2026', 'ok', ''],
      ['Afastamento', '5 dias, 10 a 14/11', 'ok', ''],
      ['Médico', 'Paulo Andrade', 'ok', ''],
      ['CRM', 'CRM-GO 9.318', 'ok', 'Formato válido'],
      ['Assinatura', 'Detectada', 'ok', ''],
    ],
    cid: 'S93.4',
    achados: [
      { sev: 'sinal', t: 'Afastamento registrado', d: 'Os dias 10 a 14/11 foram abonados e recalculados.' },
    ],
  },
  {
    id: 6, nome: 'Sebastião Prado', mat: '00441', setor: 'Colheita', enviado: '10/11 às 13:05', periodo: '03/11', dias: 1, st: 'recusado', risco: 'alto', nota: 74, arquivo: 'IMG_1877.jpg', decisao: 'Recusado em 11/11 por Lúcia Martins: atestado duplicado',
    campos: [
      ['Paciente', 'Sebastião Prado', 'ok', ''],
      ['Data de emissão', '03/11/2026', 'ok', ''],
      ['Afastamento', '1 dia, 03/11', 'ok', ''],
      ['Médico', 'Henrique Vasconcelos', 'ok', ''],
      ['CRM', 'CRM-GO 18.442', 'ok', ''],
      ['Assinatura', 'Detectada', 'ok', ''],
    ],
    cid: 'K52.9',
    achados: [
      { sev: 'alerta', t: 'Atestado duplicado', d: 'Mesmo médico e data de um atestado já registrado para outro período.' },
    ],
  },
] as const;

/** Genus RH.dc.html: AT_ST (status do atestado e grupo da aba). */
export const designCertificateStatus = {
  recebido: { icon: 'ph-tray', color: '#5A6675', label: 'Recebido', grupo: 'recebido' },
  analise: { icon: 'ph-magnifying-glass', color: '#102C50', label: 'Em análise', grupo: 'analise' },
  aprovado: { icon: 'ph-check-circle', color: '#102C50', label: 'Decidido · aprovado', grupo: 'decidido' },
  recusado: { icon: 'ph-x-circle', color: '#5A6675', label: 'Decidido · recusado', grupo: 'decidido' },
} as const;

/** Genus RH.dc.html: RISCO (faixas de risco do atestado). */
export const designRisk = {
  baixo: { label: 'Risco baixo', bg: '#E8EEF5', color: '#102C50', icon: 'ph-shield-check', bar: '#102C50' },
  medio: { label: 'Risco médio', bg: '#FDF6E7', color: '#8A5A12', icon: 'ph-warning', bar: '#B7791F' },
  alto: { label: 'Risco alto', bg: '#FBEFD9', color: '#7A4E0E', icon: 'ph-warning-octagon', bar: '#9A6516' },
} as const;

/**
 * Genus RH.dc.html: ESP (marcações do espelho de Antônio, por dia do mês; '*' = marcação ajustada).
 * Dias 1, 8 e 15 (domingos) e 20 (feriado) não têm marcações.
 * ticks: marcas da régua do espelho (buildEspelho). resumo: valores de buildEspelho() calculados à mão
 * a partir de ESP (17 dias trabalhados x 07:20 previstos). O subtítulo "18 dias úteis" é o texto literal do design.
 */
export const designMirror = {
  marcacoesPorDia: {
    2: ['06:58', '11:02', '12:01', '15:22'],
    3: ['06:55', '11:00', '12:00', '15:20'],
    4: ['06:57', '11:03', '12:02', '16:40'],
    5: ['07:01', '11:00', '12:00', '15:21'],
    6: ['06:59', '11:01', '12:00', '15:25'],
    7: ['06:58', '11:00', '12:01', '15:19'],
    9: ['06:50', '11:00', '12:00', '17:05'],
    10: ['06:58', '11:02', '12:01', '15:20'],
    11: ['07:14', '11:00', '12:00', '15:20'],
    12: ['06:58', '11:00', '12:00', '15:22'],
    13: ['06:57', '11:01', '12:01', '15:20'],
    14: ['06:58', '11:00', '12:00', '15:21'],
    16: ['06:56', '11:00', '12:00', '18:10'],
    17: ['06:58', '11:00', '12:00', '15:20'],
    18: ['06:59', '11:02', '12:00', '15:20*'],
    19: ['06:58', '11:00', '12:01', '15:21'],
    21: ['06:58', '11:01', '12:00', '15:22'],
  },
  ticks: [
    { label: '05h', hora: 5 },
    { label: '07h', hora: 7 },
    { label: '09h', hora: 9 },
    { label: '11h', hora: 11 },
    { label: '13h', hora: 13 },
    { label: '15h', hora: 15 },
    { label: '17h', hora: 17 },
    { label: '19h', hora: 19 },
  ],
  resumo: [
    { label: 'Previsto', value: '124:40', sub: '18 dias úteis · 07:20 por dia' },
    { label: 'Trabalhado', value: '131:21', sub: 'Até 21/11, inclusive' },
    { label: 'Extras a 50%', value: '06:13', sub: 'Destino: banco de horas' },
    { label: 'Atrasos e faltas', value: '00:14', sub: '1 atraso, nenhuma falta' },
    { label: 'Saldo do banco', value: '+06:40', sub: 'Vence 01:20 em 31/12' },
  ],
  observacoesDiasEspeciais: {
    domingo: { label: 'Folga', note: 'Descanso semanal' },
    feriado20: { label: 'Feriado', note: 'Dia da Consciência Negra' },
  },
} as const;

/**
 * Genus RH.dc.html: HEAD (cabeçalho de cada tela). Strings já montadas com PER e TZ do design.
 * `icon` é a classe Phosphor da ação principal.
 */
export const designHeaders = {
  geral: { title: 'Visão geral', sub: '1 a 21 de novembro de 2026 · America/Sao_Paulo', periodo: '1 a 21 nov. 2026', primary: 'Revisar inconsistências', icon: 'ph-list-checks' },
  apuracao: { title: 'Apuração do dia', sub: 'Sábado, 21 de novembro de 2026 · atualizado às 18:50 · America/Sao_Paulo', periodo: '21 nov. 2026', primary: 'Recalcular dia', icon: 'ph-arrow-clockwise' },
  ferias: { title: 'Férias', sub: 'Dezembro de 2026 · limite de férias simultâneas por setor · America/Sao_Paulo', periodo: 'Dezembro 2026', primary: 'Exportar calendário', icon: 'ph-download-simple' },
  atestados: { title: 'Atestados', sub: '1 a 21 de novembro de 2026 · America/Sao_Paulo', periodo: '1 a 21 nov. 2026', primary: 'Abrir próximo da fila', icon: 'ph-arrow-right' },
  espelho: { title: 'Espelho do colaborador', sub: '1 a 21 de novembro de 2026 · America/Sao_Paulo', periodo: '1 a 21 nov. 2026', primary: 'Gerar espelho em PDF', icon: 'ph-file-pdf' },
} as const;

/**
 * Genus RH.dc.html: EMPTY (estados vazios por tela). Textos com o estabelecimento padrão
 * (Fazenda Santa Helena) e o colaborador padrão (Antônio Carlos Ferreira) já aplicados.
 */
export const designEmptyStates = {
  geral: {
    icon: 'ph-chart-line',
    title: 'Ainda não há dados neste período',
    text: 'Os indicadores aparecem assim que os coletores de Fazenda Santa Helena sincronizarem as primeiras marcações.',
    cta: 'Ver coletores',
  },
  apuracao: {
    icon: 'ph-fingerprint-simple',
    title: 'Nenhuma marcação em 21/11',
    text: 'Nenhum colaborador deste estabelecimento registrou ponto hoje. Se for folga coletiva ou feriado local, não há nada a fazer.',
    cta: 'Ver escala do dia',
  },
  ferias: {
    icon: 'ph-sun-horizon',
    title: 'Nenhum período de férias em dezembro',
    text: 'Quando houver férias aprovadas ou pedidas no setor, elas aparecem no calendário com a ocupação diária.',
    cta: 'Lançar férias',
  },
  atestados: {
    icon: 'ph-tray',
    title: 'Fila vazia',
    text: 'Nenhum atestado aguardando análise. Os envios feitos pelos colaboradores no portal chegam aqui automaticamente.',
    cta: 'Ver decididos',
  },
  espelho: {
    icon: 'ph-calendar-x',
    title: 'Sem marcações no período',
    text: 'Antônio Carlos Ferreira não tem marcações de 1 a 21 de novembro. Confira afastamentos e férias.',
    cta: 'Ver afastamentos',
  },
} as const;

/**
 * Genus RH.dc.html: dados da visão geral (KPIs, gráfico, alertas, usuários de exemplo).
 * `destino` substitui a função go() de cada alerta: é a tela e os filtros a abrir.
 */
export const designOverview = {
  kpis: [
    { icon: 'ph-clock', label: 'Horas trabalhadas', value: '18.432', unit: 'h', delta: '3,1%', arrow: 'ph-arrow-up-right', deltaBg: '#E8EEF5', deltaColor: '#102C50', cmp: 'vs. 17.878 h em 1 a 21 de out.' },
    { icon: 'ph-timer', label: 'Horas extras', value: '1.126', unit: 'h', delta: '12,4%', arrow: 'ph-arrow-up-right', deltaBg: '#FDF6E7', deltaColor: '#8A5A12', cmp: 'vs. 1.002 h no período anterior' },
    { icon: 'ph-user-minus', label: 'Faltas', value: '37', unit: 'dias', delta: '17,8%', arrow: 'ph-arrow-down-right', deltaBg: '#E8EEF5', deltaColor: '#102C50', cmp: 'vs. 45 no período anterior' },
    { icon: 'ph-first-aid-kit', label: 'Atestados pendentes', value: '9', unit: '', delta: '+3', arrow: 'ph-arrow-up-right', deltaBg: '#FDF6E7', deltaColor: '#8A5A12', cmp: '4 há mais de 2 dias na fila' },
    { icon: 'ph-sun-horizon', label: 'Férias em curso', value: '14', unit: 'pessoas', delta: '+2', arrow: 'ph-arrow-up-right', deltaBg: '#F7FAFC', deltaColor: '#5A6675', cmp: 'de 412 colaboradores ativos' },
  ],
  alertsCount: '4 abertos',
  alerts: [
    { tag: 'Alerta', icon: 'ph-warning', bg: '#FDF6E7', color: '#8A5A12', link: '#8A5A12', title: 'Marcações ímpares em Colheita', text: '6 colaboradores sem saída registrada ontem. Revise antes do fechamento de 30/11.', cta: 'Revisar marcações', destino: { tela: 'apuracao', apSt: 'inconsistente', apSetor: 'Colheita' } },
    { tag: 'Alerta', icon: 'ph-warning', bg: '#FDF6E7', color: '#8A5A12', link: '#8A5A12', title: 'Interjornada menor que 11 h', text: '3 ocorrências em Manutenção nesta semana.', cta: 'Ver ocorrências', destino: { tela: 'apuracao', apSt: 'inconsistente', apSetor: 'Manutenção' } },
    { tag: 'Sinal', icon: 'ph-info', bg: '#E8EEF5', color: '#102C50', link: '#102C50', title: 'Jornada de 42 h a partir de 16/12', text: '18 escalas ficam acima do novo limite semanal. Ajuste antes da vigência.', cta: 'Revisar escalas', destino: { tela: 'apuracao' } },
    { tag: 'Sinal', icon: 'ph-info', bg: '#E8EEF5', color: '#102C50', link: '#102C50', title: 'Lote offline sincronizado', text: 'O coletor do Talhão 7 enviou 214 marcações de 19 e 20/11. Os dias foram recalculados.', cta: 'Ver apuração', destino: { tela: 'apuracao' } },
  ],
  /**
   * Gráfico de horas por dia (buildChart). `serieAtual` e `seriePeriodoAnterior` são os valores brutos.
   * TODO(orquestrador): calculado no design. Os pontos em pixels e a escala são obtidos assim:
   * cur[i] = serieAtual[i] * totais.atual / soma(serieAtual); prev[i] = seriePeriodoAnterior[i] * totais.anterior / soma(seriePeriodoAnterior).
   * yTicks são ceil(max(cur) / 20) * 20, em passos de 20.
   */
  grafico: {
    serieAtual: [6, 48, 52, 50, 55, 58, 31, 7, 54, 57, 60, 58, 62, 33, 8, 61, 64, 66, 63, 22, 36],
    seriePeriodoAnterior: [5, 44, 47, 49, 50, 51, 28, 6, 49, 50, 52, 51, 55, 29, 7, 52, 54, 55, 53, 47, 30],
    totais: { atual: 1126, anterior: 1002 },
    yTicks: [0, 20, 40, 60, 80],
    xLabels: ['1/11', '5/11', '10/11', '15/11', '21/11'],
    estatisticas: [
      { label: 'Total no período', value: '1.126 h' },
      { label: 'Média por dia útil', value: '62,6 h' },
      { label: 'Pico', value: '78 h em 18/11' },
      { label: 'Acima de 2 h por dia', value: '23 ocorrências' },
    ],
  },
  /** Usuários de exemplo do perfil (renderVals.user). `perfil` é o rótulo do escopo. */
  usuarios: {
    rh: { ini: 'LM', nome: 'Lúcia Martins', perfil: 'RH · Todos os estabelecimentos' },
    admin: { ini: 'RA', nome: 'Ricardo Almeida', perfil: 'Administrador da conta' },
  },
} as const;

/**
 * Genus RH.dc.html + Portal Tela.dc.html: dados de exemplo do portal do funcionário (tela Início,
 * Espelho, Férias e Atestado). Os textos vêm do markup e do script de Portal Tela.dc.html.
 */
export const designEmployeePortal = {
  usuario: { nome: 'Antônio', saudacao: 'Olá, Antônio', data: 'Sábado, 21 de novembro', estabelecimento: 'Fazenda Santa Helena · Colheita', escala: 'Escala 07:00 às 15:20' },
  abas: [
    { id: 'inicio', label: 'Início', icon: 'ph-house' },
    { id: 'espelho', label: 'Espelho', icon: 'ph-calendar-check' },
    { id: 'ferias', label: 'Férias', icon: 'ph-sun-horizon' },
    { id: 'atestado', label: 'Atestado', icon: 'ph-first-aid-kit' },
  ],
  estados: ['sucesso', 'vazio', 'carregando', 'erro', '403', 'enviado'],
  inicio: {
    saldo: '+06:40',
    saldoSub: 'Saldo até hoje · 01:20 vencem em 31/12',
    saldoVazio: '00:00',
    saldoSubVazio: 'Sem lançamentos ainda. Seu saldo começa no primeiro dia trabalhado.',
    marcacoesHoje: [
      { k: 'Entrada', t: '06:58' },
      { k: 'Intervalo', t: '11:01' },
      { k: 'Volta', t: '12:00' },
      { k: 'Saída', t: '—' },
    ],
    dias: [
      { dow: 'Sáb', dia: '21/11', marcs: '06:58 · 11:01 · 12:00 · 15:22', total: '08:25', st: 'Extra 01:05', icon: 'ph-plus-circle', color: '#102C50' },
      { dow: 'Sex', dia: '20/11', marcs: '—', total: '—', st: 'Feriado', icon: 'ph-flag', color: '#5A6675' },
      { dow: 'Qui', dia: '19/11', marcs: '06:58 · 11:00 · 12:01 · 15:21', total: '07:22', st: 'Normal', icon: 'ph-check-circle', color: '#102C50' },
      { dow: 'Qua', dia: '18/11', marcs: '06:59 · 11:02 · 12:00 · 15:20', total: '07:23', st: 'Ajuste aprovado', icon: 'ph-check-circle', color: '#102C50' },
      { dow: 'Ter', dia: '17/11', marcs: '06:58 · 11:00 · 12:00 · 15:20', total: '07:22', st: 'Normal', icon: 'ph-check-circle', color: '#102C50' },
      { dow: 'Seg', dia: '16/11', marcs: '06:56 · 11:00 · 12:00 · 18:10', total: '10:14', st: 'Extra 02:54', icon: 'ph-plus-circle', color: '#102C50' },
      { dow: 'Dom', dia: '15/11', marcs: '—', total: '—', st: 'Folga', icon: 'ph-moon', color: '#5A6675' },
    ],
    avisos: [
      { icon: 'ph-sun-horizon', titulo: 'Férias aprovadas', texto: '21 a 31 de dezembro' },
      { icon: 'ph-seal-check', titulo: 'Espelho de outubro', texto: 'Ciência registrada em 04/11' },
    ],
    erroBanner: { titulo: 'Não foi possível atualizar', texto: 'Mostrando dados de hoje às 07:10. Verifique a conexão.' },
    semMarcacoes: 'Ainda não há marcações. Elas aparecem aqui alguns minutos depois de você bater o ponto no coletor.',
  },
  espelho: {
    subtitulo: 'Novembro de 2026 · período aberto',
    trabalhado: '124:51',
    extras: '+05:16',
    ciencia: { titulo: 'Outubro: ciente', texto: 'Registrada em 04/11 às 07:12' },
  },
  ferias: {
    periodoAquisitivo: '03/2025 a 02/2026',
    diasDisponiveis: { valor: 19, total: 30 },
    usarAte: 'Usar até 02/2027',
    proximas: [
      { mes: 'dez', dia: '21', periodo: '21 a 31 de dezembro', dias: '11 dias', st: 'Aprovado' },
    ],
  },
  atestado: {
    subtitulo: 'Envie em até 2 dias da data do atestado',
    primeiroDia: '20/11/2026',
    quantosDias: '2',
    erroCampo: 'Informe de 1 a 60 dias.',
    protocolo: '2026-1121-0412',
    meusAtestados: [
      { periodo: '02 e 03/09 · 2 dias', enviado: 'Enviado em 03/09', st: 'Aprovado' },
    ],
    textoAjuda: 'O RH vai analisar e a resposta aparece aqui, em Atestado. Guarde o original em papel.',
  },
  /** Portal do Funcionário.dc.html só monta as quatro telas acima em um canvas; não tem dados próprios. */
} as const;
