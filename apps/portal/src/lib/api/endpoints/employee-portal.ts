/**
 * Portal do colaborador (/portal/me/*). O colaborador vem SEMPRE da sessão: nenhuma função aqui
 * recebe ou envia employeeId. Nunca CID, análise ou risco nesta área.
 */
import { qs, type ApiClient } from '../client';
import type {
  AccrualPeriod, Adjustment, CreateAdjustmentBody, EntityId, Envelope, Mirror, MirrorAcknowledgement, MyCertificate, MyMirrorSummary,
  PeriodQuery, RequestVacationBody, TimeBank, TimesheetDay, Vacation,
} from '../contracts';
import { apiPath } from '../ids';

export interface SubmitCertificateInput {
  file: File;
  /** AAAA-MM-DD */
  startDate: string;
  /** 1 a 365. Um dos dois: days ou hours. */
  days?: number;
  /** 1 a 24. */
  hours?: number;
  doctorName?: string;
  doctorCrm?: string;
  doctorCrmUf?: string;
}

export const employeePortalApi = (c: ApiClient) => ({
  timesheets: async (q: PeriodQuery, signal?: AbortSignal) =>
    (await c.get<Envelope<TimesheetDay[]>>(`/portal/me/timesheets${qs({ from: q.from, to: q.to })}`, signal)).data,
  timeBank: async (signal?: AbortSignal) => (await c.get<Envelope<TimeBank>>('/portal/me/time-bank', signal)).data,
  mirrors: async (signal?: AbortSignal) => (await c.get<Envelope<MyMirrorSummary[]>>('/portal/me/mirrors', signal)).data,
  mirror: async (closingId: EntityId, signal?: AbortSignal) => (await c.get<Envelope<Mirror>>(apiPath`/portal/me/mirrors/${closingId}`, signal)).data,
  acknowledge: async (closingId: EntityId) =>
    (await c.post<Envelope<MirrorAcknowledgement>>(apiPath`/portal/me/mirrors/${closingId}/acknowledge`)).data,
  requestAdjustment: async (body: CreateAdjustmentBody) => (await c.post<Envelope<Adjustment>>('/portal/me/adjustments', body)).data,
  vacations: async (signal?: AbortSignal) => (await c.get<Envelope<AccrualPeriod[]>>('/portal/me/vacations', signal)).data,
  requestVacation: async (body: RequestVacationBody) => (await c.post<Envelope<Vacation>>('/portal/me/vacations', body)).data,
  certificates: async (signal?: AbortSignal) => (await c.get<Envelope<MyCertificate[]>>('/portal/me/certificates', signal)).data,
  submitCertificate: async (input: SubmitCertificateInput) => {
    const form = new FormData();
    form.set('startDate', input.startDate);
    if (input.days !== undefined) form.set('days', String(input.days));
    if (input.hours !== undefined) form.set('hours', String(input.hours));
    if (input.doctorName) form.set('doctorName', input.doctorName);
    if (input.doctorCrm) form.set('doctorCrm', input.doctorCrm);
    if (input.doctorCrmUf) form.set('doctorCrmUf', input.doctorCrmUf);
    form.set('file', input.file); // por último: o back lê os campos antes do arquivo
    return (await c.postForm<Envelope<MyCertificate>>('/portal/me/certificates', form)).data;
  },
});
export type EmployeePortalApi = ReturnType<typeof employeePortalApi>;
