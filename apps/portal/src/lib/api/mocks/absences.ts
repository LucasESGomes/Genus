/**
 * Mock de absences (dono: lote C). Mesmo contrato de endpoints/absences.ts. Dados fictícios.
 * Erros no formato da api (mockFail): 404 fora do escopo, 409 AFASTAMENTO_SOBREPOSTO (EXCLUDE
 * `afast_sem_sobreposicao` do back), 422 com `details`. Nunca há diagnóstico: só o tipo.
 */
import type { Absence } from '../contracts';
import type { AbsencesApi } from '../endpoints/absences';
import { clone, delay, mockFail, mockId, mockNotFound } from './runtime';
import { seedEmployee } from './seed';

const ABSENCES: Absence[] = [
  { id: '5001', employeeId: '107', type: 'maternidade', startDate: '2026-03-02', endDate: '2026-06-29', certificateId: null },
  { id: '5002', employeeId: '107', type: 'doacao_sangue', startDate: '2026-10-14', endDate: '2026-10-14', certificateId: null },
];

/** Afastamentos de um colaborador (usado também pelo mock de timesheets para marcar os dias). */
export const absencesOf = (employeeId: string): Absence[] => ABSENCES.filter((a) => a.employeeId === employeeId);

export const mockAbsencesApi: AbsencesApi = {
  list: async (employeeId) => {
    await delay();
    if (!seedEmployee(employeeId)) throw mockNotFound();
    return clone(absencesOf(employeeId).sort((a, b) => a.startDate.localeCompare(b.startDate)));
  },
  create: async (employeeId, body) => {
    await delay();
    if (!seedEmployee(employeeId)) throw mockNotFound();
    if (body.endDate < body.startDate) {
      throw mockFail(422, 'VALIDATION_ERROR', 'Dados inválidos', [{ path: 'endDate', message: 'fim antes do início' }]);
    }
    const overlaps = absencesOf(employeeId).some((a) => a.startDate <= body.endDate && body.startDate <= a.endDate);
    if (overlaps) throw mockFail(409, 'AFASTAMENTO_SOBREPOSTO', 'O afastamento se sobrepõe a outro do colaborador');
    const created: Absence = { id: mockId(), employeeId, type: body.type, startDate: body.startDate, endDate: body.endDate, certificateId: null };
    ABSENCES.push(created);
    return clone(created);
  },
};
