'use client';
import {
  Buildings, CalendarBlank, CalendarCheck, CaretDown, CaretUpDown, ChartBar, Check, FirstAidKit, GearSix,
  HourglassMedium, LockSimple, PencilSimpleLine, SidebarSimple, SquaresFour, SunHorizon, Users, type Icon,
} from '@phosphor-icons/react';
import { useState, type ReactNode } from 'react';
import { ROLE_LABEL } from '@/lib/auth/permissions';
import { useSession } from '@/lib/session';

export type NavId = 'geral' | 'colab' | 'escala' | 'ajustes' | 'ferias' | 'atest' | 'banco' | 'fech' | 'rel' | 'conf';

const NAV: { id: NavId; label: string; icon: Icon }[] = [
  { id: 'geral', label: 'Visão geral', icon: SquaresFour },
  { id: 'colab', label: 'Colaboradores', icon: Users },
  { id: 'escala', label: 'Escala e apuração', icon: CalendarCheck },
  { id: 'ajustes', label: 'Ajustes', icon: PencilSimpleLine },
  { id: 'ferias', label: 'Férias', icon: SunHorizon },
  { id: 'atest', label: 'Atestados', icon: FirstAidKit },
  { id: 'banco', label: 'Banco de horas', icon: HourglassMedium },
  { id: 'fech', label: 'Fechamento', icon: LockSimple },
  { id: 'rel', label: 'Relatórios', icon: ChartBar },
  { id: 'conf', label: 'Configurações', icon: GearSix },
];

const initials = (n: string) => { const p = n.trim().split(/\s+/); return ((p[0]?.[0] ?? '') + (p.length > 1 ? p[p.length - 1]![0] : '')).toUpperCase(); };

export function Shell({ current, onNavigate, title, subtitle, period, primary, children }: {
  current: NavId; onNavigate?: (id: NavId) => void; title: string; subtitle: string; period: string;
  primary?: { label: string; icon: ReactNode; onClick?: () => void }; children: ReactNode;
}) {
  const { me, establishments, establishment, setEstablishmentId } = useSession();
  const [expanded, setExpanded] = useState(true);
  const [estabOpen, setEstabOpen] = useState(false);
  return (
    <div className="flex min-h-screen bg-white text-ink">
      <aside className={`sticky top-0 z-[5] flex h-screen shrink-0 flex-col border-r border-line bg-white transition-[width] duration-[180ms] ${expanded ? 'w-60' : 'w-[72px]'}`}>
        <div className="flex h-[68px] shrink-0 items-center gap-2.5 px-[22px]">
          <div className="relative h-7 w-7 shrink-0 rounded-sm bg-brand" aria-hidden>
            <div className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-accent" />
            <div className="absolute right-1.5 bottom-[7px] left-1.5 h-[3px] rounded-[2px] bg-white" />
          </div>
          {expanded && <span className="text-xl font-bold tracking-[-0.03em]">Genus</span>}
        </div>

        <div className="relative shrink-0 px-3 pb-3">
          <button type="button" aria-label="Trocar estabelecimento" aria-expanded={estabOpen} onClick={() => setEstabOpen((o) => !o)}
            className={`flex min-h-12 w-full cursor-pointer items-center gap-2.5 rounded-md border border-line bg-surface text-left hover:border-line-hover ${expanded ? 'px-3 py-2' : 'justify-center py-2'}`}>
            <Buildings size={20} className="shrink-0 text-brand" aria-hidden />
            {expanded && (<>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-semibold">{establishment.name}</span>
                <span className="text-xs text-muted">{establishment.subtitle}</span>
              </span>
              <CaretUpDown size={16} className="text-muted" aria-hidden />
            </>)}
          </button>
          {estabOpen && (
            <div role="listbox" aria-label="Estabelecimentos" className="absolute top-14 left-3 z-20 w-[216px] rounded-lg border border-line bg-white p-1.5 shadow-pop">
              <div className="px-2.5 py-1.5 text-xs text-muted">Estabelecimentos</div>
              {establishments.map((e) => (
                <button key={e.id} type="button" role="option" aria-selected={e.id === establishment.id}
                  onClick={() => { setEstablishmentId(e.id); setEstabOpen(false); }}
                  className={`flex w-full cursor-pointer items-center gap-2.5 rounded-sm border-0 px-2.5 py-2 text-left hover:bg-surface ${e.id === establishment.id ? 'bg-surface' : 'bg-transparent'}`}>
                  <span className="flex flex-1 flex-col"><span className="font-semibold">{e.name}</span><span className="text-xs text-muted">{e.subtitle}</span></span>
                  {e.id === establishment.id && <Check size={16} className="text-brand" aria-hidden />}
                </button>
              ))}
            </div>
          )}
        </div>

        <nav aria-label="Menu principal" className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-1">
          {NAV.map(({ id, label, icon: I }) => {
            const active = id === current;
            return (
              <button key={id} type="button" title={label} aria-current={active ? 'page' : undefined} onClick={() => onNavigate?.(id)}
                className={`relative flex h-10 cursor-pointer items-center gap-3 rounded-md border-0 px-3 text-left ${expanded ? 'justify-start' : 'justify-center'} ${active ? 'bg-tint font-semibold text-brand' : 'bg-transparent font-medium text-ink-2 hover:bg-surface'}`}>
                {active && <span className="absolute top-2 bottom-2 -left-3 w-[3px] rounded-r-[3px] bg-brand" aria-hidden />}
                <I size={20} className="shrink-0" aria-hidden />
                {expanded ? <span className="whitespace-nowrap">{label}</span> : <span className="sr-only">{label}</span>}
              </button>
            );
          })}
        </nav>

        <div className="flex shrink-0 flex-col gap-1 border-t border-line p-3">
          <button type="button" onClick={() => setExpanded((e) => !e)} title={expanded ? 'Recolher menu' : 'Expandir menu'}
            className={`flex h-10 cursor-pointer items-center gap-3 rounded-md border-0 bg-transparent px-3 text-muted hover:bg-surface ${expanded ? 'justify-start' : 'justify-center'}`}>
            <SidebarSimple size={20} aria-hidden />
            {expanded ? <span>Recolher menu</span> : <span className="sr-only">Expandir menu</span>}
          </button>
          <div className={`flex items-center gap-2.5 py-2 ${expanded ? 'px-1' : 'px-1.5'}`}>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-tint text-[13px] font-bold text-brand" aria-hidden>{initials(me.name)}</div>
            {expanded && <div className="flex min-w-0 flex-col"><span className="truncate font-semibold">{me.name}</span><span className="text-xs text-muted">Perfil {ROLE_LABEL[me.role].toLowerCase()}</span></div>}
          </div>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-end justify-between gap-4 px-8 pt-7 pb-5">
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="m-0 text-2xl font-bold tracking-[-0.02em]">{title}</h1>
            <div className="text-muted tabular-nums">{subtitle}</div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="flex h-10 cursor-pointer items-center gap-2 rounded-md border border-line bg-white px-3.5 font-medium tabular-nums hover:border-line-hover hover:bg-surface">
              <CalendarBlank size={18} className="text-muted" aria-hidden /><span>{period}</span><CaretDown size={14} className="text-muted" aria-hidden />
            </button>
            {primary && (
              <button type="button" onClick={primary.onClick} className="flex h-10 cursor-pointer items-center gap-2 rounded-full border-0 bg-brand px-5 font-semibold text-white hover:bg-brand-hover active:bg-brand-active">
                {primary.icon}<span>{primary.label}</span>
              </button>
            )}
          </div>
        </header>
        <div className="flex flex-col gap-4 px-8 pb-28">{children}</div>
      </main>
    </div>
  );
}
