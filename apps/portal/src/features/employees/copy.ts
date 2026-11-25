/** Textos da tela de colaboradores (pt-BR). */
export const COPY = {
  title: 'Colaboradores',
  subtitle: 'Cadastro, vínculos e desligamento. As marcações nunca são alteradas por aqui.',
  newEmployee: 'Novo colaborador',
  searchLabel: 'Buscar colaborador por nome ou matrícula',
  tabsLabel: 'Situação dos colaboradores',
  tableCaption: 'Colaboradores',
  empty: { title: 'Nenhum colaborador', text: 'Não há colaboradores nesta visão. Cadastre o primeiro para começar a apurar as marcações.' },
  emptySearchText: 'Confira a grafia ou busque pela matrícula. Limpe o campo para ver todos.',
  cpfReadOnlyHint: 'O CPF liga o colaborador às marcações e não muda.',
  establishmentReadOnlyHint: 'O estabelecimento não muda depois do cadastro.',
  pin: {
    title: 'PIN inicial',
    text: 'Anote este PIN e entregue ao colaborador. Ele aparece só agora: depois que você fechar esta janela, não há como ver de novo.',
    copy: 'Copiar PIN',
    copied: 'PIN copiado',
    ack: 'Anotei o PIN',
    close: 'Concluir',
  },
  terminate: {
    title: 'Desligar colaborador',
    description: 'O desligamento encerra o vínculo a partir da data informada. As marcações já registradas continuam guardadas e nada é apagado (Portaria 671).',
    confirm: 'Desligar',
    reason: 'Motivo do desligamento',
  },
} as const;

export const STATUS_TABS = ['ativo', 'desligado', 'todos'] as const;
export type StatusTab = (typeof STATUS_TABS)[number];
export const PAGE_SIZE = 25;
