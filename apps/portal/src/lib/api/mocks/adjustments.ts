/**
 * Mock de adjustments (dono: lote F). Mesmo contrato de endpoints/adjustments.ts, com dados fictícios.
 * Faz o papel do servidor: aprovar/recusar mudam o estado em memória; decidir de novo devolve 409
 * STATUS_INVALIDO; abono é só do RH; quem pediu não decide (DECISOR_IGUAL_SOLICITANTE); mês fechado
 * recusa (PERIODO_FECHADO). Mensagens e códigos copiados de apps/api (adjustments/service.ts, domain-errors.ts).
 * Aprovar nunca mexe na marcação original: o mock de timesheets segue devolvendo as marcações como estão.
 */
import { systemClock } from '../../clock';
import type { Adjustment, CreateAdjustmentBody } from '../contracts';
import type { AdjustmentsApi } from '../endpoints/adjustments';
import { mockCurrentRole, mockMeFor } from './index';
import { clone, delay, matchesQuery, mockFail, mockId, mockNotFound, paginate } from './runtime';
import { seedEmployee } from './seed';

/** Competências até esta data (inclusive) estão fechadas no mock. */
const LAST_CLOSED_DAY = '2026-09-30';

const REQUESTED_BY_EMPLOYEE = '5';
const DECIDER = '1';

const adj = (a: Partial<Adjustment> & Pick<Adjustment, 'id' | 'employeeId' | 'date' | 'type' | 'reason' | 'status' | 'requestedAt'>): Adjustment => ({
  proposedAt: null,
  requestedById: REQUESTED_BY_EMPLOYEE,
  decidedById: a.status === 'pendente' ? null : DECIDER,
  decidedAt: null,
  decisionReason: null,
  ...a,
});

function seed(): Adjustment[] {
  return [
    // O dia 21/11 do José Roberto (104) tem a saída faltando: a proposta é a saída que ele esqueceu de bater.
    adj({ id: '1', employeeId: '104', date: '2026-11-21', type: 'inclusao_batida', proposedAt: '2026-11-21T15:30:00-03:00', reason: 'Esqueci de bater a saída; encerrei o turno às 15:30 no Talhão 4.', status: 'pendente', requestedAt: '2026-11-22T11:12:00-03:00' }),
    adj({ id: '2', employeeId: '103', date: '2026-11-19', type: 'justificativa', reason: 'Consulta médica pela manhã; cheguei às 9h e compensei no fim do dia.', status: 'pendente', requestedAt: '2026-11-20T08:40:00-03:00' }),
    adj({ id: '3', employeeId: '107', date: '2026-11-19', type: 'abono', reason: 'Acompanhei meu filho em consulta pediátrica; levo a declaração do hospital.', status: 'pendente', requestedAt: '2026-11-20T09:05:00-03:00' }),
    adj({ id: '4', employeeId: '110', date: '2026-11-18', type: 'justificativa', reason: 'Falta de energia na oficina das 14h às 16h, sem como registrar o ponto.', status: 'pendente', requestedAt: '2026-11-19T17:30:00-03:00' }),
    adj({ id: '5', employeeId: '102', date: '2026-11-17', type: 'inclusao_batida', proposedAt: '2026-11-17T15:20:00-03:00', reason: 'O coletor do Talhão 2 ficou sem sinal na saída.', status: 'aprovado', requestedAt: '2026-11-18T07:55:00-03:00', decidedAt: '2026-11-18T10:20:00-03:00', decisionReason: 'Conferido com o encarregado do talhão.' }),
    adj({ id: '6', employeeId: '105', date: '2026-11-14', type: 'justificativa', reason: 'Cheguei atrasado por causa do bloqueio da estrada.', status: 'aprovado', requestedAt: '2026-11-16T08:02:00-03:00', decidedAt: '2026-11-16T09:15:00-03:00' }),
    adj({ id: '7', employeeId: '108', date: '2026-11-13', type: 'inclusao_batida', proposedAt: '2026-11-13T18:00:00-03:00', reason: 'Saí mais tarde para terminar a colheita do talhão.', status: 'recusado', requestedAt: '2026-11-14T07:40:00-03:00', decidedAt: '2026-11-14T11:00:00-03:00', decisionReason: 'Já existe saída registrada neste dia; o horário proposto não bate com ela.' }),
    adj({ id: '8', employeeId: '106', date: '2026-11-12', type: 'abono', reason: 'Doação de sangue, com comprovante do hemocentro.', status: 'aprovado', requestedAt: '2026-11-13T08:10:00-03:00', decidedAt: '2026-11-13T09:00:00-03:00', decisionReason: 'Comprovante conferido.' }),
    adj({ id: '9', employeeId: '111', date: '2026-11-05', type: 'inclusao_batida', proposedAt: '2026-11-05T12:00:00-03:00', reason: 'Esqueci de bater a ida para o almoço.', status: 'recusado', requestedAt: '2026-11-06T08:30:00-03:00', decidedAt: '2026-11-06T10:10:00-03:00', decisionReason: 'Sem como confirmar o horário; peça ao encarregado para atestar.' }),
  ];
}

let store: Adjustment[] = seed();

/** Volta ao estado inicial (testes). */
export function resetMockAdjustments() {
  store = seed();
}

const currentUserId = () => {
  const role = mockCurrentRole();
  return role === 'super_admin' ? '1' : mockMeFor(role).id;
};

function decide(id: string, status: 'aprovado' | 'recusado', note: string | undefined): Adjustment {
  const current = store.find((a) => a.id === id);
  if (!current) throw mockNotFound();
  // Abono é decidido só pelo RH (adjustments/service.ts).
  if (mockCurrentRole() === 'gestor' && current.type === 'abono') throw mockFail(403, 'FORBIDDEN', 'Abono é decidido só pelo RH');
  if (current.status !== 'pendente') throw mockFail(409, 'STATUS_INVALIDO', 'O ajuste já foi decidido');
  if (current.requestedById === currentUserId()) throw mockFail(409, 'DECISOR_IGUAL_SOLICITANTE', 'Quem fez o pedido não pode decidir sobre ele');
  if (current.date <= LAST_CLOSED_DAY) throw mockFail(409, 'PERIODO_FECHADO', 'O período está fechado: reabra antes de alterar');
  current.status = status;
  current.decidedById = currentUserId();
  current.decidedAt = systemClock.now().toISOString();
  current.decisionReason = note ?? null;
  return clone(current);
}

function validateCreate(body: CreateAdjustmentBody) {
  if (body.type === 'inclusao_batida' && !body.proposedAt) {
    throw mockFail(422, 'VALIDATION_ERROR', 'Dados inválidos', [{ path: 'proposedAt', message: 'inclusão de batida exige o horário' }]);
  }
  if (body.type !== 'inclusao_batida' && body.proposedAt) {
    throw mockFail(422, 'VALIDATION_ERROR', 'Dados inválidos', [{ path: 'proposedAt', message: 'só a inclusão de batida tem horário' }]);
  }
  const reason = body.reason.trim();
  if (reason.length < 3 || reason.length > 500) {
    throw mockFail(422, 'VALIDATION_ERROR', 'Dados inválidos', [{ path: 'reason', message: 'de 3 a 500 caracteres' }]);
  }
}

export const mockAdjustmentsApi: AdjustmentsApi = {
  list: async (q) => {
    await delay();
    const rows = store
      .filter((a) => (!q.status || a.status === q.status) && (!q.employeeId || a.employeeId === q.employeeId) && matchesQuery(q.q, seedEmployee(a.employeeId)?.name, seedEmployee(a.employeeId)?.registrationNumber))
      .sort((a, b) => (a.requestedAt === b.requestedAt ? Number(b.id) - Number(a.id) : a.requestedAt < b.requestedAt ? 1 : -1));
    return clone(paginate(rows, q));
  },
  create: async (employeeId, body) => {
    await delay();
    if (!seedEmployee(employeeId)) throw mockNotFound();
    validateCreate(body);
    if (body.date <= LAST_CLOSED_DAY) throw mockFail(409, 'PERIODO_FECHADO', 'O período está fechado: reabra antes de alterar');
    const created: Adjustment = {
      id: mockId(), employeeId, date: body.date, type: body.type, proposedAt: body.proposedAt ?? null, reason: body.reason.trim(),
      status: 'pendente', requestedById: currentUserId(), requestedAt: systemClock.now().toISOString(), decidedById: null, decidedAt: null, decisionReason: null,
    };
    store.unshift(created);
    return clone(created);
  },
  approve: async (id, body) => {
    await delay();
    return decide(id, 'aprovado', body.note?.trim() || undefined);
  },
  reject: async (id, body) => {
    await delay();
    const reason = body.reason.trim();
    if (reason.length < 3 || reason.length > 500) {
      throw mockFail(422, 'VALIDATION_ERROR', 'Dados inválidos', [{ path: 'reason', message: 'de 3 a 500 caracteres' }]);
    }
    return decide(id, 'recusado', reason);
  },
};
