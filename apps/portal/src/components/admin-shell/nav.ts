/** Menu do painel da operação Genus (/admin). Só o super_admin chega aqui (AuthGate area="admin"). */
import {
  ChartLineUp, Buildings, ClipboardText, Heartbeat, ScanSmiley, ShieldCheck, UserCircleGear,
  type Icon,
} from '@phosphor-icons/react';

export interface AdminNavItem {
  href: string;
  label: string;
  icon: Icon;
}

export const ADMIN_NAV: AdminNavItem[] = [
  { href: '/admin', label: 'Visão geral', icon: ChartLineUp },
  { href: '/admin/empresas', label: 'Empresas', icon: Buildings },
  { href: '/admin/auditoria', label: 'Auditoria', icon: ClipboardText },
  { href: '/admin/acessos', label: 'Acessos e IPs', icon: ShieldCheck },
  { href: '/admin/reconhecimento', label: 'Reconhecimento', icon: ScanSmiley },
  { href: '/admin/saude', label: 'Saúde dos sistemas', icon: Heartbeat },
  { href: '/admin/perfil', label: 'Perfil e 2FA', icon: UserCircleGear },
];

/** Item ativo: o de prefixo mais longo que casa com a rota (`/admin` só casa exato). */
export function activeAdminNav(pathname: string, items: AdminNavItem[] = ADMIN_NAV): AdminNavItem | undefined {
  const matches = (base: string) => pathname === base || (base !== '/admin' && pathname.startsWith(`${base}/`));
  return items.filter((i) => matches(i.href)).sort((a, b) => b.href.length - a.href.length)[0];
}
