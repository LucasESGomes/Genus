'use client';
import { FirstAidKit, Fingerprint, HourglassMedium, SealCheck, SunHorizon } from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import Link from 'next/link';
import { Minutes } from '@/components/domain';
import { Card } from '@/components/ui/Card';
import { QueryView } from '@/components/ui/QueryView';
import { Skeleton } from '@/components/ui/States';
import type { AccrualPeriod, MyMirrorSummary, Punch, TimeBank } from '@/lib/api/contracts';
import { useClock } from '@/lib/clock-context';
import { DEFAULT_TZ, formatDate, formatMinutes, formatMonth, formatPeriod, formatTime, todayCivil } from '@/lib/format';
import { useSession } from '@/lib/session';
import { MIN_PUNCH_SLOTS, punchSlotLabel } from './copy';
import { useMyMirrors, useMyTimeBank, useMyTimesheets, useMyVacations } from './hooks';
import { LoadingBlock } from './parts';
import { PortalFrame } from './PortalFrame';

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/** Início: saldo do banco de horas, marcações de hoje e avisos derivados (a api não tem endpoint de avisos). */
export function HomeScreen() {
  const { me } = useSession();
  const clock = useClock();
  const today = todayCivil(clock, DEFAULT_TZ);
  // Empresa e setor não vêm da api: ficam fora do cabeçalho.
  return (
    <PortalFrame eyebrow={formatDate(today, 'long')} title={`Olá, ${firstName(me.name)}`}>
      <BalanceCard />
      <Link
        href="/me/atestado"
        className="flex min-h-14 w-full items-center justify-center gap-2.5 rounded-full bg-brand px-5 text-lg font-bold text-white hover:bg-brand-hover active:bg-brand-active"
      >
        <FirstAidKit size={22} aria-hidden />
        Enviar atestado
      </Link>
      <TodayCard today={today} />
      <Notices today={today} />
    </PortalFrame>
  );
}

function BalanceCard() {
  const q = useMyTimeBank();
  return (
    <QueryView query={q} what="o banco de horas" loading={<LoadingBlock><Skeleton className="h-[132px] rounded-[20px]" /></LoadingBlock>}>
      {(bank) => <BalanceBody bank={bank} />}
    </QueryView>
  );
}

function BalanceBody({ bank }: { bank: TimeBank }) {
  const noEntries = bank.balanceMinutes === 0 && bank.entries.length === 0;
  const sub = noEntries
    ? 'Sem lançamentos ainda. Seu saldo começa no primeiro dia trabalhado.'
    : `Saldo até hoje${bank.expiringIn30DaysMinutes > 0 ? ` · ${formatMinutes(bank.expiringIn30DaysMinutes)} vencem em 30 dias` : ''}`;
  return (
    <section aria-label="Banco de horas" className="flex flex-col gap-1 rounded-[20px] bg-brand p-5">
      <h2 className="m-0 flex items-center gap-1.5 text-sm font-semibold text-white/85">
        <HourglassMedium size={18} aria-hidden />
        Banco de horas
      </h2>
      {/* Número-chave sobre o azul da marca: único uso do limão nesta tela. */}
      <span className="text-[40px] font-bold leading-[48px] tracking-[-0.03em] text-accent">
        <Minutes value={bank.balanceMinutes} signed />
      </span>
      <p className="m-0 text-sm text-white/85">{sub}</p>
    </section>
  );
}

function TodayCard({ today }: { today: string }) {
  const q = useMyTimesheets(today, today);
  return (
    <QueryView query={q} what="as marcações de hoje" loading={<LoadingBlock><Skeleton className="h-28 rounded-card" /></LoadingBlock>}>
      {(days) => {
        const day = days.find((d) => d.date === today);
        const punches = [...(day?.punches ?? [])].sort((a, b) => a.sequence - b.sequence);
        return (
          <Card as="section" className="flex flex-col gap-2.5 p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="m-0 text-base font-bold">Hoje</h2>
              {day && day.expectedMinutes > 0 && (
                <span className="text-sm text-muted">Jornada prevista <Minutes value={day.expectedMinutes} /></span>
              )}
            </div>
            {punches.length === 0 ? (
              <p className="m-0 flex items-start gap-2.5 text-sm text-ink-2">
                <Fingerprint size={22} aria-hidden className="shrink-0 text-muted" />
                Ainda não há marcações. Elas aparecem aqui alguns minutos depois de você bater o ponto no coletor.
              </p>
            ) : (
              <PunchSlots punches={punches} />
            )}
          </Card>
        );
      }}
    </QueryView>
  );
}

function PunchSlots({ punches }: { punches: Punch[] }) {
  const count = Math.max(MIN_PUNCH_SLOTS, punches.length);
  return (
    <ul aria-label="Marcações de hoje" className="m-0 flex list-none flex-wrap gap-2 p-0">
      {Array.from({ length: count }, (_, i) => {
        const p = punches[i];
        return (
          <li
            key={i}
            className={`flex min-w-[68px] flex-col items-center rounded-[10px] border px-3 py-1.5 ${p ? 'border-line bg-surface' : 'border-dashed border-line-strong bg-white'}`}
          >
            <span className="text-xs text-muted">{punchSlotLabel(i)}</span>
            <span className={`font-bold tabular-nums ${p ? '' : 'text-muted'}`}>{p ? formatTime(p.at, DEFAULT_TZ) : 'pendente'}</span>
          </li>
        );
      })}
    </ul>
  );
}

interface Notice { key: string; icon: Icon; title: string; text: string; href: string }

/** Avisos derivados de férias aprovadas e espelhos fechados sem ciência. */
export function deriveNotices(periods: AccrualPeriod[] | undefined, mirrors: MyMirrorSummary[] | undefined, today: string): Notice[] {
  const out: Notice[] = [];
  for (const p of periods ?? []) {
    for (const v of p.vacations) {
      if (v.status === 'aprovada' && v.endDate >= today) {
        out.push({ key: `v-${v.id}`, icon: SunHorizon, title: 'Férias aprovadas', text: formatPeriod(v.startDate, v.endDate), href: '/me/ferias' });
      }
    }
  }
  for (const m of mirrors ?? []) {
    if (m.status === 'fechado' && m.acknowledgedAt === null) {
      const month = formatMonth(m.referenceMonth).split(' de ')[0] ?? m.referenceMonth;
      out.push({ key: `m-${m.closingId}`, icon: SealCheck, title: `Espelho de ${month} pronto para ciência`, text: 'Toque para conferir e dar ciência.', href: `/me/espelho?mes=${m.referenceMonth}` });
    }
  }
  return out;
}

function Notices({ today }: { today: string }) {
  const vacations = useMyVacations();
  const mirrors = useMyMirrors();
  const notices = deriveNotices(vacations.data, mirrors.data, today);
  if (notices.length === 0) return null;
  return (
    <section aria-labelledby="avisos" className="flex flex-col gap-2">
      <h2 id="avisos" className="m-0 text-base font-bold">Avisos</h2>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {notices.map(({ key, icon: I, title, text, href }) => (
          <li key={key}>
            <Link href={href} className="flex min-h-14 items-center gap-3 rounded-card border border-line px-4 py-3.5">
              <I size={22} aria-hidden className="shrink-0 text-brand" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-semibold">{title}</span>
                <span className="text-sm text-muted">{text}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
