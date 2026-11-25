'use client';
/**
 * Espelhos de uma competência (mapa §4.11): lista os colaboradores do estabelecimento e abre o espelho
 * fechado de um deles. Tudo o que aparece vem da api (totais, saldo do banco, ciência); o front só formata.
 * `closingId` e `employeeId` chegam da URL já validados como ID opaco: inválido nunca chama a api.
 */
import type { ColumnDef } from '@tanstack/react-table';
import { CaretLeft, FilePdf, UsersThree } from '@phosphor-icons/react';
import { useMemo } from 'react';
import { Minutes } from '@/components/domain/Minutes';
import { PunchChips } from '@/components/domain/PunchChips';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { DataTable } from '@/components/ui/DataTable';
import { KeyValueList } from '@/components/ui/KeyValueList';
import { QueryView } from '@/components/ui/QueryView';
import { SidePanel } from '@/components/ui/SidePanel';
import { EmptyState, LoadingState } from '@/components/ui/States';
import type { Closing, Employee, EntityId, Mirror, TimesheetDay } from '@/lib/api/contracts';
import { daySituationLabel } from '@/lib/labels';
import { DEFAULT_TZ, formatDate, formatInstant, formatMonth } from '@/lib/format';
import { useApiQuery } from '@/lib/query/hooks';
import { entryLabel } from '@/features/time-bank/copy';
import { COPY } from './copy';

export function MirrorPanel({ closing, employeeId, onSelectEmployee, onClose }: {
  closing: Closing;
  employeeId: EntityId | null;
  onSelectEmployee: (id: EntityId | null) => void;
  onClose: () => void;
}) {
  const month = formatMonth(closing.referenceMonth);
  return (
    <SidePanel
      open
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={`Espelhos de ${month}`}
      description={`Período de ${formatDate(closing.startDate)} a ${formatDate(closing.endDate)}`}
      width="lg"
    >
      {employeeId === null ? (
        <EmployeeList closing={closing} onSelect={onSelectEmployee} />
      ) : (
        <MirrorView closing={closing} employeeId={employeeId} onBack={() => onSelectEmployee(null)} />
      )}
    </SidePanel>
  );
}

function EmployeeList({ closing, onSelect }: { closing: Closing; onSelect: (id: EntityId) => void }) {
  const q = useApiQuery(
    'employees',
    { closingEmployees: closing.establishmentId },
    async (api, signal) => (await api.employees.list({ establishmentId: closing.establishmentId, pageSize: 100 }, signal)).data,
  );
  const columns = useMemo<ColumnDef<Employee, never>[]>(
    () => [
      {
        id: 'employee',
        header: 'Colaborador',
        cell: ({ row: { original: e } }) => (
          <div className="flex items-center gap-2.5">
            <Avatar name={e.name} size="sm" />
            <div className="flex flex-col">
              <span className="font-semibold">{e.name}</span>
              {e.registrationNumber && <span className="text-xs text-muted tabular-nums">Mat. {e.registrationNumber}</span>}
            </div>
          </div>
        ),
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">Ações</span>,
        cell: ({ row: { original: e } }) => (
          <div className="flex justify-end">
            <Button variant="secondary" size="sm" aria-label={`Ver espelho de ${e.name}`} onClick={() => onSelect(e.id)}>Ver espelho</Button>
          </div>
        ),
      },
    ],
    [onSelect],
  );
  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-sm text-muted">{COPY.mirrorsHint}</p>
      <QueryView
        query={q}
        what="os colaboradores"
        loading={<DataTable caption="Carregando os colaboradores" columns={columns} data={[]} getRowId={(e) => e.id} loadingRows={5} />}
        isEmpty={(d) => d.length === 0}
        empty={<EmptyState icon={UsersThree} title="Nenhum colaborador neste estabelecimento" text="Não há colaboradores para listar os espelhos." />}
      >
        {(data) => <DataTable caption={`Colaboradores com espelho em ${formatMonth(closing.referenceMonth)}`} columns={columns} data={data} getRowId={(e) => e.id} />}
      </QueryView>
    </div>
  );
}

function MirrorView({ closing, employeeId, onBack }: { closing: Closing; employeeId: EntityId; onBack: () => void }) {
  const q = useApiQuery('mirrors', { closingId: closing.id, employeeId }, (api, signal) => api.closings.mirror(closing.id, employeeId, signal));
  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button variant="ghost" size="sm" icon={<CaretLeft size={14} aria-hidden />} onClick={onBack}>Voltar à lista</Button>
      </div>
      <QueryView query={q} what="o espelho" loading={<LoadingState label="Carregando o espelho…" />}>
        {(m) => <MirrorContent mirror={m} />}
      </QueryView>
    </div>
  );
}

const TOTALS: { key: keyof Mirror['totals']; label: string }[] = [
  { key: 'expectedMinutes', label: 'Previsto' },
  { key: 'workedMinutes', label: 'Trabalhado' },
  { key: 'absenceMinutes', label: 'Faltas' },
  { key: 'lateMinutes', label: 'Atrasos' },
  { key: 'overtime50Minutes', label: 'Extras 50%' },
  { key: 'overtime100Minutes', label: 'Extras 100%' },
  { key: 'nightMinutes', label: 'Noturno' },
];

function MirrorContent({ mirror: m }: { mirror: Mirror }) {
  const columns = useMemo<ColumnDef<TimesheetDay, never>[]>(
    () => [
      { id: 'date', header: 'Dia', cell: ({ row: { original: d } }) => <span className="whitespace-nowrap font-semibold tabular-nums">{formatDate(d.date, 'weekday')}</span> },
      { id: 'situation', header: 'Situação', cell: ({ row: { original: d } }) => <span className="text-ink-2">{daySituationLabel(d.situation).label}</span> },
      { id: 'punches', header: 'Marcações', cell: ({ row: { original: d } }) => <PunchChips punches={d.punches} tz={DEFAULT_TZ} /> },
      { id: 'worked', header: 'Trabalhado', cell: ({ row: { original: d } }) => (d.punches.length > 0 ? <Minutes value={d.workedMinutes} /> : <span className="text-muted">—</span>) },
      { id: 'late', header: 'Atraso', cell: ({ row: { original: d } }) => (d.lateMinutes > 0 ? <Minutes value={d.lateMinutes} emphasis="warn" /> : <span className="text-muted">—</span>) },
    ],
    [],
  );
  const name = m.employee.name;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <Avatar name={name} size="lg" />
        <div className="flex min-w-0 flex-col">
          <h3 className="m-0 text-lg font-bold">{name}</h3>
          <span className="text-sm text-muted">
            {m.employee.registrationNumber ? `Mat. ${m.employee.registrationNumber} · ` : ''}
            {m.acknowledgedAt ? `Ciência em ${formatInstant(m.acknowledgedAt)}` : COPY.noAcknowledgement}
          </span>
        </div>
      </div>

      <section aria-labelledby="mirror-totals" className="flex flex-col gap-2">
        <h4 id="mirror-totals" className="m-0 text-sm font-semibold">Totais da competência</h4>
        <dl className="m-0 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {TOTALS.map((t) => (
            <div key={t.key} className="rounded-md border border-line bg-surface px-3 py-2">
              <dt className="text-xs text-muted">{t.label}</dt>
              <dd className="m-0 text-base font-bold"><Minutes value={m.totals[t.key]} /></dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="mirror-bank" className="flex flex-col gap-2">
        <h4 id="mirror-bank" className="m-0 text-sm font-semibold">Banco de horas</h4>
        <KeyValueList items={[{ label: 'Saldo', value: <Minutes value={m.timeBank.balanceMinutes} signed /> }]} />
        {m.timeBank.periodEntries.length > 0 ? (
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
            {m.timeBank.periodEntries.map((e, i) => (
              <li key={`${e.date}-${i}`} className="flex justify-between gap-3 border-b border-line-soft py-1 last:border-b-0">
                <span>{formatDate(e.date)} · {entryLabel(e.type)}</span>
                <Minutes value={e.minutes} signed />
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 text-sm text-muted">Nenhum lançamento no período.</p>
        )}
      </section>

      <section aria-labelledby="mirror-days" className="flex flex-col gap-2">
        <h4 id="mirror-days" className="m-0 text-sm font-semibold">Dias</h4>
        <DataTable caption={`Dias do espelho de ${name}`} columns={columns} data={m.days} getRowId={(d) => d.date} />
      </section>

      <div className="flex flex-col gap-1">
        {m.pdfUrl !== null && /^(https:\/\/|\/)/.test(m.pdfUrl) ? (
          <a
            href={m.pdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-10 w-fit items-center justify-center gap-2 rounded-full border border-line-strong bg-white px-[18px] font-semibold hover:bg-surface"
          >
            <FilePdf size={18} aria-hidden />
            Baixar PDF
          </a>
        ) : (
          <>
            <div>
              <Button variant="secondary" disabled aria-describedby="mirror-pdf-note" icon={<FilePdf size={18} aria-hidden />}>Baixar PDF</Button>
            </div>
            <p id="mirror-pdf-note" className="m-0 text-xs text-muted">{COPY.pdfPending}</p>
          </>
        )}
      </div>
    </div>
  );
}
