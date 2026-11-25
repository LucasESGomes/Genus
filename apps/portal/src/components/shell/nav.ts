/** Menu do painel de RH (ordem do design + Totens). Cada item some se o papel não tem `nav.*`. */
import {
  CalendarCheck, ChartBar, DeviceTabletCamera, FirstAidKit, GearSix, HourglassMedium, LockSimple, PencilSimpleLine, SquaresFour, SunHorizon, Users,
  type Icon,
} from '@phosphor-icons/react';
import type { Action } from '@/lib/auth/permissions';

export interface NavItem {
  href: string;
  label: string;
  icon: Icon;
  action: Action;
  /** Outras rotas que acendem este item (ex.: /rh/escalas acende "Escala e apuração"). */
  also?: string[];
  /** Item com ponto de pendência (a contagem vem da api, só leitura). */
  attention?: 'certificates' | 'adjustments';
}

export const RH_NAV: NavItem[] = [
  { href: '/rh', label: 'Visão geral', icon: SquaresFour, action: 'nav.overview' },
  { href: '/rh/colaboradores', label: 'Colaboradores', icon: Users, action: 'nav.employees' },
  { href: '/rh/apuracao', label: 'Escala e apuração', icon: CalendarCheck, action: 'nav.timesheets', also: ['/rh/escalas'] },
  { href: '/rh/ajustes', label: 'Ajustes', icon: PencilSimpleLine, action: 'nav.adjustments', attention: 'adjustments' },
  { href: '/rh/ferias', label: 'Férias', icon: SunHorizon, action: 'nav.vacations' },
  { href: '/rh/atestados', label: 'Atestados', icon: FirstAidKit, action: 'nav.certificates', attention: 'certificates' },
  { href: '/rh/banco-horas', label: 'Banco de horas', icon: HourglassMedium, action: 'nav.timeBank' },
  { href: '/rh/fechamento', label: 'Fechamento', icon: LockSimple, action: 'nav.closings' },
  { href: '/rh/relatorios', label: 'Relatórios', icon: ChartBar, action: 'nav.reports' },
  { href: '/rh/totens', label: 'Totens', icon: DeviceTabletCamera, action: 'nav.devices' },
  { href: '/rh/configuracoes', label: 'Configurações', icon: GearSix, action: 'nav.settings' },
];

/** Item ativo: o de prefixo mais longo que casa com a rota atual. */
export function activeNav(pathname: string, items: NavItem[] = RH_NAV): NavItem | undefined {
  const matches = (base: string) => pathname === base || (base !== '/rh' && pathname.startsWith(`${base}/`));
  return items
    .filter((i) => matches(i.href) || i.also?.some(matches))
    .sort((a, b) => b.href.length - a.href.length)[0];
}
