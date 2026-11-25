'use client';
/**
 * Dados do portal do funcionário. O colaborador é sempre o da sessão: nenhuma função aqui
 * recebe nem envia employeeId. Leituras do "eu" ficam no módulo de cache `me`.
 */
import { useApiMutation, useApiQuery } from '@/lib/query/hooks';
import type { SubmitCertificateInput } from '@/lib/api/endpoints/employee-portal';
import type { CreateAdjustmentBody, RequestVacationBody } from '@/lib/api/contracts';

export const useMyTimeBank = () => useApiQuery('me', { r: 'time-bank' }, (api, signal) => api.employeePortal.timeBank(signal));

export const useMyTimesheets = (from: string, to: string) =>
  useApiQuery('me', { r: 'timesheets', from, to }, (api, signal) => api.employeePortal.timesheets({ from, to }, signal));

export const useMyMirrors = () => useApiQuery('mirrors', { scope: 'mine' }, (api, signal) => api.employeePortal.mirrors(signal));

export const useMyVacations = () => useApiQuery('vacations', { scope: 'mine' }, (api, signal) => api.employeePortal.vacations(signal));

export const useMyCertificates = () => useApiQuery('certificates', { scope: 'mine' }, (api, signal) => api.employeePortal.certificates(signal));

export const useAcknowledge = () =>
  useApiMutation((api, closingId: string) => api.employeePortal.acknowledge(closingId), { invalidates: ['mirrors', 'me'] });

export const useRequestAdjustment = () =>
  useApiMutation((api, body: CreateAdjustmentBody) => api.employeePortal.requestAdjustment(body), {
    invalidates: ['me', 'timesheets', 'day', 'adjustments'],
  });

export const useRequestVacation = () =>
  useApiMutation((api, body: RequestVacationBody) => api.employeePortal.requestVacation(body), { invalidates: ['vacations', 'me'] });

export const useSubmitCertificate = () =>
  useApiMutation((api, input: SubmitCertificateInput) => api.employeePortal.submitCertificate(input), { invalidates: ['certificates', 'me'] });
