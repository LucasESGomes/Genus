/**
 * Ponto único de lançamento no banco de horas (G8). A apuração (G4) chama o hook
 * dentro da própria transação, depois de gravar o dia; quem implementa é o módulo
 * time-bank. Assim o recálculo automático, o manual, o ajuste e o afastamento
 * lançam pelo mesmo caminho.
 */
import type { Executor } from '../../db/executor';
import type { EmployeeRecord } from '../employees/lookup';
import type { CivilDate } from '../rules-common/rules/civil-time';
import type { DayResult } from '../timesheets/rules/day';

export interface PostedDay {
  dailyTimesheetId: number;
  date: CivilDate;
  result: DayResult;
  /** Janela do dia encerrada: só então o banco de horas lança. */
  isClosed: boolean;
}

export interface DayPostingHook {
  apply(tx: Executor, emp: EmployeeRecord, day: PostedDay): Promise<void>;
}
