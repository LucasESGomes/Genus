import { daySituationLabel } from '@/lib/labels';
/** Textos do portal do funcionário (pt-BR, linguagem simples). */
import { CalendarCheck, FirstAidKit, House, SunHorizon } from '@phosphor-icons/react';
import type { BottomNavItem } from '@/components/domain';

export const PORTAL_NAV: BottomNavItem[] = [
  { href: '/me', label: 'Início', icon: House },
  { href: '/me/espelho', label: 'Espelho', icon: CalendarCheck },
  { href: '/me/ferias', label: 'Férias', icon: SunHorizon },
  { href: '/me/atestado', label: 'Atestado', icon: FirstAidKit },
];

/** Rótulo de `situation` (tabela única em lib/labels; valor desconhecido aparece como veio). */
export const situationLabel = (situation: string) => daySituationLabel(situation).label;

/** Nomes das marcações do dia, na ordem. Depois da quarta, "Marcação N". */
const PUNCH_SLOTS = ['Entrada', 'Intervalo', 'Volta', 'Saída'];
export const punchSlotLabel = (index: number) => PUNCH_SLOTS[index] ?? `Marcação ${index + 1}`;
export const MIN_PUNCH_SLOTS = PUNCH_SLOTS.length;

export const MAX_CERTIFICATE_BYTES = 10 * 1024 * 1024;
export const CERTIFICATE_ACCEPT = 'image/*,application/pdf';
/** O back aceita só estes tipos (ARQUIVO_INVALIDO). */
export const CERTIFICATE_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];

export const COPY = {
  retry: 'Tentar de novo',
  sendCertificate: 'Enviar atestado',
  requestAdjustment: 'Pedir ajuste de marcação',
  requestVacation: 'Pedir férias',
} as const;
