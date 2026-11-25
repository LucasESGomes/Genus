'use client';
import { keepPreviousData } from '@tanstack/react-query';
import type { AssignScheduleBody, CreateScheduleBody, EntityId, Schedule, UpdateScheduleBody } from '@/lib/api/contracts';
import { useApiMutation, useApiQuery } from '@/lib/query/hooks';
import { establishmentParam, useSession } from '@/lib/session';

/**
 * Escalas do estabelecimento COM dias e avisos. A listagem da api não traz `warnings`, então há uma
 * chamada de detalhe por escala (poucas por estabelecimento). Lacuna: a lista deveria trazer os avisos.
 */
export function useSchedules(enabled: boolean, q?: string) {
  const { establishment } = useSession();
  return useApiQuery(
    'schedules',
    { list: true, q },
    async (api, signal): Promise<Schedule[]> => {
      const list = await api.schedules.list({ establishmentId: establishmentParam(establishment), q }, signal);
      return Promise.all(list.map((s) => api.schedules.get(s.id, signal)));
    },
    { enabled, placeholderData: keepPreviousData },
  );
}

export const useCreateSchedule = () => useApiMutation((api, body: CreateScheduleBody) => api.schedules.create(body), { invalidates: ['schedules', 'overview'] });

export const useUpdateSchedule = () =>
  useApiMutation((api, v: { id: EntityId; body: UpdateScheduleBody }) => api.schedules.update(v.id, v.body), { invalidates: ['schedules', 'overview', 'timesheets', 'day'] });

export const useAssignSchedule = () =>
  useApiMutation((api, v: { employeeId: EntityId; body: AssignScheduleBody }) => api.schedules.assign(v.employeeId, v.body), {
    invalidates: ['schedules', 'timesheets', 'day'],
  });
