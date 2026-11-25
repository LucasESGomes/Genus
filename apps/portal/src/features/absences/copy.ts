import { MANUAL_ABSENCE_TYPES, type ManualAbsenceType } from '@/lib/api/contracts';
import { MANUAL_ABSENCE_TYPE } from '@/lib/labels';

export const ABSENCE_COPY = {
  title: 'Afastamentos',
  register: 'Registrar afastamento',
  none: 'Nenhum afastamento registrado para este colaborador.',
  panelHint: 'O afastamento muda a apuração dos dias do intervalo: eles são recalculados. As marcações originais não mudam.',
  certificateNote: 'Afastamento por atestado não se registra aqui: ele nasce da aprovação do atestado.',
  pickType: 'Escolha o tipo do afastamento.',
  dateRequired: 'Informe a data.',
  endBeforeStart: 'O último dia não pode vir antes do primeiro.',
  save: 'Registrar',
  saved: 'Afastamento registrado',
  savedHint: 'Os dias do intervalo serão recalculados.',
} as const;

const isManual = (t: string): t is ManualAbsenceType => (MANUAL_ABSENCE_TYPES as readonly string[]).includes(t);

/** Só o tipo (nunca diagnóstico). `atestado` aparece como "Atestado"; valor desconhecido, genérico. */
export const absenceTypeLabel = (type: string) => (isManual(type) ? MANUAL_ABSENCE_TYPE[type].label : type === 'atestado' ? 'Atestado' : 'Afastamento');
