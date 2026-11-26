/**
 * Lançamento automático no banco de horas (G8): o `DayPostingHook` que a
 * apuração chama dentro da transação dela, já com o lock do colaborador.
 *
 * O ledger só recebe INSERT: grava a diferença entre o que o dia vale
 * (`rules/posting.ts`) e o que já foi lançado para ele. Recalcular sem mudança
 * não grava nada. Só lança dia encerrado e com regra de banco de horas na data.
 */
import type { Clock } from '@genus/shared';
import type { Executor } from '../../db/executor';
import type { EmployeeRecord } from '../employees/lookup';
import { loadLegalParameters } from '../legal-parameters/repository';
import type { DayPostingHook, PostedDay } from './posting-hook';
import { findPolicyOn, insertEntry, postedMinutes } from './repository';
import { creditDueDate } from './rules/ledger';
import { dayTargetMinutes } from './rules/posting';

export class TimeBankPoster implements DayPostingHook {
  constructor(private readonly d: { clock: Clock }) {}

  async apply(tx: Executor, emp: EmployeeRecord, day: PostedDay): Promise<void> {
    if (!day.isClosed) return;
    const policy = await findPolicyOn(tx, { tenantId: emp.tenantId, employeeId: emp.id, establishmentId: emp.establishmentId }, day.date);
    if (!policy) return;

    const difference = dayTargetMinutes(day.result, policy) - (await postedMinutes(tx, emp.tenantId, emp.id, day.dailyTimesheetId));
    if (difference === 0) return;

    const dueDate =
      difference > 0
        ? creditDueDate(day.date, policy.modality, await loadLegalParameters(tx, emp.tenantId, emp.companyId), String(emp.companyId))
        : null;
    await insertEntry(tx, {
      tenantId: emp.tenantId,
      employeeId: emp.id,
      dailyTimesheetId: day.dailyTimesheetId,
      type: difference > 0 ? 'credito' : 'debito',
      minutes: difference,
      referenceDate: day.date,
      dueDate,
      createdById: null,
      createdAt: this.d.clock.now(),
    });
  }
}
