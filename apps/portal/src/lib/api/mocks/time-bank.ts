/**
 * Mock de time-bank (dono: lote G). Mesmo contrato de endpoints/time-bank.ts. Aqui o mock faz o papel do
 * servidor: o saldo é a soma do extrato, o "a vencer em 30 dias" é calculado a partir do "hoje" fixo do
 * mock e a regra do banco guarda vigências em memória. Esta aritmética NÃO existe no portal.
 * Erros no formato da api: 404 fora do escopo, 409 BANCO_REGRA_VIGENCIA, 422 com `details`.
 */
import { TIME_BANK_MODALITIES, type EmployeeTimeBank, type TimeBankBalanceRow, type TimeBankEntry, type TimeBankPolicy } from '../contracts';
import type { TimeBankApi } from '../endpoints/time-bank';
import { mockEstablishments } from './index';
import { clone, delay, matchesQuery, mockFail, mockId, mockNotFound, paginate } from './runtime';
import { SEED_EMPLOYEES } from './seed';

/** "Hoje" do mock e fim da janela de 30 dias (AAAA-MM-DD). */
const TODAY = '2026-11-24';
const WINDOW_END = '2026-12-24';

const pad = (n: number) => String(n).padStart(2, '0');

function entriesOf(employeeId: string): TimeBankEntry[] {
  const n = Number(employeeId);
  const entries: TimeBankEntry[] = [
    { date: '2026-09-10', type: 'credito', minutes: 120, dueDate: '2027-03-10' },
    { date: '2026-10-05', type: 'credito', minutes: 60 + (n % 5) * 30, dueDate: n % 3 === 0 ? `2026-12-${pad(5 + (n % 15))}` : '2027-04-05' },
    { date: '2026-10-20', type: 'debito', minutes: -30 * (1 + (n % 4)), dueDate: null },
  ];
  if (n % 2 === 1) entries.push({ date: '2026-11-03', type: 'folga_compensatoria', minutes: -240, dueDate: null });
  if (n % 5 === 0) entries.push({ date: '2026-11-12', type: 'pagamento', minutes: -600, dueDate: null });
  return entries;
}

const summarize = (entries: TimeBankEntry[]) => {
  const credits = entries.filter((e) => e.type === 'credito' && e.dueDate !== null);
  const expiring = credits.filter((e) => (e.dueDate as string) >= TODAY && (e.dueDate as string) <= WINDOW_END);
  const due = credits.map((e) => e.dueDate as string).sort();
  return {
    balanceMinutes: entries.reduce((s, e) => s + e.minutes, 0),
    expiringIn30DaysMinutes: expiring.reduce((s, e) => s + e.minutes, 0),
    nextDueDate: due[0] ?? null,
  };
};

// ---- regra do banco por estabelecimento. Só o '1' começa com regra; os outros mostram o aviso. ----

const seedPolicies = (): TimeBankPolicy[] => [
  { id: '7001', establishmentId: '1', modality: 'individual_6m', sundayWeight: '2.00', holidayWeight: '2.00', validFrom: '2026-01-01', validTo: null },
];
let policies = seedPolicies();
/** Para testes: volta às regras iniciais do mock. */
export const resetMockTimeBankPolicies = () => {
  policies = seedPolicies();
};

const assertEstablishment = (id: string) => {
  if (!mockEstablishments.some((e) => e.id === id)) throw mockNotFound();
};
const dayBefore = (civil: string) => new Date(Date.parse(`${civil}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
/** Da mais antiga para a mais nova. */
const policiesOf = (establishmentId: string) =>
  policies.filter((p) => p.establishmentId === establishmentId).sort((a, b) => a.validFrom.localeCompare(b.validFrom));

const WEIGHT = /^[1-9]\.\d{2}$/;

export const mockTimeBankApi: TimeBankApi = {
  balances: async (q) => {
    await delay();
    const rows: TimeBankBalanceRow[] = SEED_EMPLOYEES.filter((e) => e.establishmentId === q.establishmentId && e.status === 'ativo' && matchesQuery(q.q, e.name, e.registrationNumber)).map((e) => {
      const s = summarize(entriesOf(e.id));
      return { employeeId: e.id, employeeName: e.name, departmentName: e.departmentName, ...s };
    });
    return clone(paginate(rows, q));
  },
  byEmployee: async (employeeId) => {
    await delay();
    if (!SEED_EMPLOYEES.some((e) => e.id === employeeId)) throw mockNotFound();
    const entries = entriesOf(employeeId);
    const { balanceMinutes, expiringIn30DaysMinutes } = summarize(entries);
    const out: EmployeeTimeBank = { balanceMinutes, expiringIn30DaysMinutes, entries };
    return clone(out);
  },
  policy: async (establishmentId) => {
    await delay();
    assertEstablishment(establishmentId);
    const all = policiesOf(establishmentId);
    const current = all.find((p) => p.validFrom <= TODAY && (p.validTo === null || p.validTo >= TODAY));
    return clone(current ?? all.find((p) => p.validFrom > TODAY) ?? null);
  },
  savePolicy: async (establishmentId, body) => {
    await delay();
    assertEstablishment(establishmentId);
    const details = [
      ...(TIME_BANK_MODALITIES.includes(body.modality) ? [] : [{ path: 'modality', message: 'modalidade inválida' }]),
      ...(['sundayWeight', 'holidayWeight'] as const).filter((k) => !WEIGHT.test(body[k])).map((k) => ({ path: k, message: 'use um peso de 1.00 a 9.99' })),
      ...(/^\d{4}-\d{2}-\d{2}$/.test(body.validFrom) ? [] : [{ path: 'validFrom', message: 'use AAAA-MM-DD' }]),
    ];
    if (details.length > 0) throw mockFail(422, 'VALIDATION_ERROR', 'Dados inválidos', details);
    const latest = policiesOf(establishmentId).at(-1);
    if (latest && body.validFrom < latest.validFrom) {
      throw mockFail(409, 'BANCO_REGRA_VIGENCIA', 'O início da vigência é anterior ao da regra vigente');
    }
    if (latest && body.validFrom === latest.validFrom) {
      Object.assign(latest, body);
      return clone(latest);
    }
    if (latest) latest.validTo = dayBefore(body.validFrom);
    const created: TimeBankPolicy = { id: mockId(), establishmentId, ...body, validTo: null };
    policies.push(created);
    return clone(created);
  },
};
