/** Textos da estrutura da empresa (setores, cargos, centros de custo). */
export const ORG_COPY = {
  intro: (establishment: string) =>
    `Setores são de ${establishment}. Cargos e centros de custo valem para a empresa inteira. O vínculo do colaborador usa estes cadastros.`,
  departments: 'Setores',
  departmentsHint: 'Do estabelecimento selecionado. Guardam o limite de férias simultâneas.',
  jobTitles: 'Cargos',
  jobTitlesHint: 'Da empresa. O CBO é opcional.',
  costCenters: 'Centros de custo',
  costCentersHint: 'Da empresa. Opcionais no vínculo.',
  add: 'Adicionar',
  edit: 'Editar',
  saved: 'Cadastro salvo',
  emptyTitle: (what: string) => `Nenhum ${what} cadastrado`,
  emptyText: 'Cadastre aqui antes de criar o vínculo do colaborador.',
  panelHint: 'Não há exclusão: o item pode estar no histórico de algum vínculo.',
  vacationsHint: 'Quantas pessoas do setor podem estar de férias ao mesmo tempo. Mínimo 1.',
  cboHint: 'Classificação Brasileira de Ocupações, 6 dígitos (opcional).',
  duplicateName: 'Já existe um cadastro com esse nome.',
  duplicateCode: 'Já existe um centro de custo com esse código.',
  createTitle: { department: 'Novo setor', jobTitle: 'Novo cargo', costCenter: 'Novo centro de custo' },
  editTitle: { department: 'Editar setor', jobTitle: 'Editar cargo', costCenter: 'Editar centro de custo' },
} as const;
