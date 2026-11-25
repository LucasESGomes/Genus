'use client';
import { Plus, SunHorizon } from '@phosphor-icons/react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { QueryView } from '@/components/ui/QueryView';
import { EmptyState, Skeleton } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import type { AccrualPeriod, Vacation } from '@/lib/api/contracts';
import { useClock } from '@/lib/clock-context';
import { DEFAULT_TZ, formatDate, formatMonth, formatPeriod, plural, todayCivil } from '@/lib/format';
import { VACATION_STATUS } from '@/lib/labels';
import { COPY } from './copy';
import { useMyVacations } from './hooks';
import { LoadingBlock } from './parts';
import { PortalFrame } from './PortalFrame';
import { periodLabel, VacationSheet } from './VacationSheet';

/** Escolhe o período aquisitivo em foco: o mais recente que ainda tem dias; senão, o mais recente. */
export function currentPeriod(periods: AccrualPeriod[]): AccrualPeriod | undefined {
  const byStart = [...periods].sort((a, b) => b.startDate.localeCompare(a.startDate));
  return byStart.find((p) => p.remainingDays > 0) ?? byStart[0];
}

/** Férias: dias disponíveis, próximas, histórico e pedido de férias em folha inferior. */
export function VacationsScreen() {
  const clock = useClock();
  const today = todayCivil(clock, DEFAULT_TZ);
  const q = useMyVacations();
  const [asking, setAsking] = useState(false);
  const current = q.data ? currentPeriod(q.data) : undefined;

  return (
    <PortalFrame title="Férias" subtitle={current ? `Período aquisitivo ${periodLabel(current)}` : undefined}>
      <QueryView
        query={q}
        what="as férias"
        loading={<LoadingBlock className="flex flex-col gap-3"><Skeleton className="h-[116px] rounded-[20px]" /><Skeleton className="h-16 rounded-card" /><Skeleton className="h-14 rounded-full" /></LoadingBlock>}
        isEmpty={(periods) => periods.length === 0}
        empty={<EmptyState icon={SunHorizon} title="Você ainda não tem férias a pedir" text="Quando completar um período aquisitivo, os dias aparecem aqui." />}
      >
        {(periods) => {
          const all = periods.flatMap((p) => p.vacations);
          const upcoming = all.filter((v) => (v.status === 'solicitada' || v.status === 'aprovada') && v.endDate >= today).sort((a, b) => a.startDate.localeCompare(b.startDate));
          const history = all.filter((v) => !upcoming.includes(v)).sort((a, b) => b.startDate.localeCompare(a.startDate));
          const cur = currentPeriod(periods);
          return (
            <>
              {cur && (
                <section aria-label="Dias disponíveis" className="flex flex-col gap-1 rounded-[20px] bg-tint p-5">
                  <h2 className="m-0 text-sm font-semibold text-brand">Dias disponíveis</h2>
                  <span className="text-[40px] font-bold leading-[48px] tracking-[-0.03em] tabular-nums">
                    {cur.remainingDays}
                    <span className="text-base font-semibold text-ink-2"> de {cur.entitledDays}</span>
                  </span>
                  <span className="text-sm text-ink-2">Usar até {formatDate(cur.grantDeadline)}</span>
                </section>
              )}
              <VacationList title="Próximas" items={upcoming} empty="Nenhuma férias marcada." />
              {history.length > 0 && <VacationList title="Histórico" items={history} />}
              <Button className="min-h-14 w-full text-base font-bold" icon={<Plus size={20} aria-hidden />} onClick={() => setAsking(true)}>{COPY.requestVacation}</Button>
              <p className="m-0 text-sm text-muted">O pedido passa pelo RH. Se o setor já estiver no limite de pessoas em férias, você recebe o motivo.</p>
              <VacationSheet open={asking} onOpenChange={setAsking} periods={periods} />
            </>
          );
        }}
      </QueryView>
    </PortalFrame>
  );
}

function VacationList({ title, items, empty }: { title: string; items: Vacation[]; empty?: string }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="m-0 text-base font-bold">{title}</h2>
      {items.length === 0 ? (
        empty && <p className="m-0 text-sm text-muted">{empty}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {items.map((v) => {
            const status = VACATION_STATUS[v.status];
            return (
              <li key={v.id} className="flex flex-col gap-1.5 rounded-card border border-line px-4 py-3.5">
                <div className="flex items-center gap-3">
                  <div aria-hidden className="flex size-11 shrink-0 flex-col items-center justify-center rounded-xl bg-surface leading-[1.1]">
                    <span className="text-xs text-muted">{formatMonth(v.startDate.slice(0, 7)).slice(0, 3)}</span>
                    <span className="font-bold tabular-nums">{v.startDate.slice(8, 10)}</span>
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="font-semibold">{formatPeriod(v.startDate, v.endDate)}</span>
                    <span className="text-sm text-muted">{plural(v.days, 'dia', 'dias')}{v.cashBonusDays > 0 ? ` e abono de ${plural(v.cashBonusDays, 'dia', 'dias')}` : ''}</span>
                  </div>
                  <StatusBadge label={status.label} tone={status.tone} />
                </div>
                {v.decisionReason && <p className="m-0 text-sm text-ink-2">Motivo: {v.decisionReason}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
