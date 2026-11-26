/** Textos e rótulos locais da apuração. Rótulos de enumeração do back ficam em lib/labels. */
import { plural } from '@/lib/format';
import type { Label } from '@/lib/labels';

export const COPY = {
  dayTitle: 'Escala e apuração',
  recalcDay: 'Recalcular dia',
  recalcDayDone: 'Dia recalculado',
  loadingNames: 'carregando os nomes…',
  seeSchedules: 'Ver escalas',
  searchLabel: 'Buscar colaborador por nome ou matrícula',
  pickEstablishmentTitle: 'Escolha um estabelecimento',
  pickEstablishmentText: 'A apuração do dia é de um estabelecimento por vez. Use o seletor no menu lateral.',
  originalNeverChanges: 'Marcação original nunca é alterada. Ajustes ficam registrados à parte.',
  pdfPending: 'O PDF assinado ainda não está disponível: o serviço de assinatura não devolve o endereço do arquivo (pdfUrl).',
  periodTotalsLabel: 'Soma do período (exibição)',
  periodTotalsNote: 'Soma simples dos minutos que a apuração entregou, só para exibir. Não é cálculo de folha.',
} as const;

/** Dia de falta (a api diz por `isAbsence`; "falta" não é valor de `status`). */
export const ABSENCE_LABEL: Label = { label: 'Falta', tone: 'warn' };

/** `situation` vem da api como texto; rótulo só para exibir. Valor desconhecido aparece como veio. */
const SITUATION: Record<string, string> = {
  normal: 'Normal',
  falta: 'Falta',
  folga: 'Folga',
  feriado: 'Feriado',
  ferias: 'Férias',
  afastamento: 'Afastado',
};
export const situationLabel = (s: string) => SITUATION[s] ?? s;

export const emptyDayTitle = (ddmm: string) => `Nenhuma marcação em ${ddmm}`;

export const recalculatedText = (n: number) => plural(n, 'colaborador recalculado', 'colaboradores recalculados');
export const skippedTitle = (n: number) => plural(n, 'colaborador ficou de fora', 'colaboradores ficaram de fora');
