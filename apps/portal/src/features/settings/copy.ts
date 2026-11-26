/** [SEM DESIGN] Textos da prévia de Configurações. */
export const COPY = {
  title: 'Configurações',
  subtitle: 'Prévia · salvar depende do servidor',
  noticeTitle: 'Prévia: as configurações ainda não são salvas',
  noticeText: 'Os dados abaixo são só para leitura. O servidor ainda não tem usuários, parâmetros nem feriados, então os botões de ação ficam desabilitados.',
  tabsLabel: 'Seções de configurações',
  pending: 'Aguardando back: gestão de configurações',
  inviteUser: 'Convidar usuário',
  save: 'Salvar',
  addHoliday: 'Adicionar feriado',
  allEstablishments: 'Todos',
  managerPortalLabel: 'Portal do gestor habilitado',
  managerPortalHint: 'Quando ligado, gestores entram no portal para ver a própria equipe e decidir ajustes e férias. Desligado, as telas de aprovação ficam só com o RH.',
  vacationsLabel: 'Férias simultâneas por setor (máximo)',
  vacationsHint: 'Quantas pessoas do mesmo setor podem estar de férias ao mesmo tempo. Mínimo 1.',
  toleranceLabel: 'Tolerância de marcação (minutos)',
  toleranceHint: 'Parâmetro da empresa; regras legais ficam no servidor. [A CONFIRMAR] o limite legal da tolerância.',
} as const;

export type SettingsTab = 'estrutura' | 'usuarios' | 'parametros' | 'feriados';

export const TABS: { value: SettingsTab; label: string }[] = [
  { value: 'estrutura', label: 'Estrutura' },
  { value: 'usuarios', label: 'Usuários e escopo' },
  { value: 'parametros', label: 'Parâmetros da empresa' },
  { value: 'feriados', label: 'Feriados' },
];

export const HOLIDAY_SCOPE: Record<'nacional' | 'estadual' | 'municipal' | 'empresa', string> = {
  nacional: 'Nacional',
  estadual: 'Estadual',
  municipal: 'Municipal',
  empresa: 'Da empresa',
};
