/**
 * Mock de devices (dono: lote H). Mesmo contrato de endpoints/devices.ts. Dados fictícios.
 * Erros no formato da api (mockFail): 404 fora do escopo ou id desconhecido, 409 de nome duplicado e de
 * aparelho com batidas (APARELHO_NOME_DUPLICADO, APARELHO_COM_BATIDAS), 422 de limiar fora da faixa.
 * A chave (`gk_` + 40 hex fictícios) só sai em create e regenerateKey, uma vez; o registro guarda só o prefixo.
 * A sessão de calibração simula o totem: nasce `aguardando` e vira `calculada` ~6 s depois (ou ao chamar
 * `completeMockCalibration`, ajuda de teste e de demonstração).
 */
import { systemClock } from '../../clock';
import type {
  CalibrationSession, CalibrationSessionResult, Device, DeviceActivity, DeviceCalibrationSettings, EntityId,
} from '../contracts';
import type { DevicesApi } from '../endpoints/devices';
import { mockEstablishments } from './index';
import { clone, delay, matchesQuery, mockFail, mockId, mockNotFound } from './runtime';

/** Tempo que o totem simulado leva para enviar as capturas e a sessão ficar calculada. */
const SIMULATED_TOTEM_MS = 6000;
const DEFAULT_RECOGNITION = 1.1;
const DEFAULT_LIVENESS = 0.85;
/** Instante fixo dos eventos criados no mock (sem ler o relógio). */
const MOCK_NOW = '2026-11-24T13:00:00.000Z';

interface Overrides {
  recognitionThreshold: number | null;
  livenessThreshold: number | null;
}

interface Row {
  device: Device;
  overrides: Overrides;
  isCalibrated: boolean;
  calibratedAt: string | null;
  sourceId: EntityId | null;
  sourceName: string | null;
  activity: DeviceActivity[];
}

interface Session {
  session: CalibrationSession;
  startedMs: number;
}

const act = (id: string, at: string, type: DeviceActivity['type'], description: string): DeviceActivity => ({ id, at, type, description });

function seedRows(): Row[] {
  return [
    {
      device: {
        id: '1', establishmentId: '1', name: 'Portaria principal', isActive: true, connection: 'online', lastSyncAt: '2026-11-24T12:58:00.000Z',
        pendingPunches: 0, appVersion: '1.8.2', calibrationState: 'padrao', hasPunches: true, createdAt: '2026-03-10T11:00:00.000Z',
        keyPrefix: 'gk_3f9a1',
      },
      overrides: { recognitionThreshold: null, livenessThreshold: null }, isCalibrated: false, calibratedAt: null, sourceId: null, sourceName: null,
      activity: [
        act('a1', '2026-11-24T12:58:00.000Z', 'sincronizacao', 'Sincronização concluída, sem lote pendente'),
        act('a2', '2026-11-24T06:01:00.000Z', 'conexao', 'Totem conectado'),
        act('a3', '2026-03-10T11:00:00.000Z', 'ativado', 'Totem cadastrado e ativado'),
      ],
    },
    {
      device: {
        id: '2', establishmentId: '1', name: 'Talhão 7', isActive: true, connection: 'offline', lastSyncAt: '2026-11-20T21:40:00.000Z',
        pendingPunches: 214, appVersion: '1.8.1', calibrationState: 'desatualizado', hasPunches: true, createdAt: '2026-04-02T14:30:00.000Z',
        keyPrefix: 'gk_b27c0',
      },
      overrides: { recognitionThreshold: 1.05, livenessThreshold: 0.85 }, isCalibrated: true, calibratedAt: '2026-05-12T16:20:00.000Z', sourceId: null, sourceName: null,
      activity: [
        act('b1', '2026-11-20T21:40:00.000Z', 'desconexao', 'Totem sem conexão há mais de 3 dias'),
        act('b2', '2026-11-20T21:39:00.000Z', 'sincronizacao', 'Lote de 214 batidas recebido (19 e 20/11)'),
        act('b3', '2026-05-12T16:20:00.000Z', 'calibracao', 'Calibração aplicada'),
      ],
    },
    {
      device: {
        id: '3', establishmentId: '2', name: 'Balança da usina', isActive: false, connection: 'inativo', lastSyncAt: '2026-09-30T18:00:00.000Z',
        pendingPunches: 0, appVersion: '1.7.9', calibrationState: 'padrao', hasPunches: false, createdAt: '2026-08-20T09:15:00.000Z',
        keyPrefix: 'gk_5d81e',
      },
      overrides: { recognitionThreshold: null, livenessThreshold: null }, isCalibrated: false, calibratedAt: null, sourceId: null, sourceName: null,
      activity: [
        act('c1', '2026-09-30T18:05:00.000Z', 'desativado', 'Totem desativado'),
        act('c2', '2026-08-20T09:15:00.000Z', 'ativado', 'Totem cadastrado e ativado'),
      ],
    },
    {
      device: {
        id: '4', establishmentId: '2', name: 'Portaria da usina', isActive: true, connection: 'online', lastSyncAt: '2026-11-24T12:55:00.000Z',
        pendingPunches: 3, appVersion: '1.8.2', calibrationState: 'calibrado', hasPunches: true, createdAt: '2026-06-05T10:00:00.000Z',
        keyPrefix: 'gk_e04a7',
      },
      overrides: { recognitionThreshold: 0.98, livenessThreshold: 0.88 }, isCalibrated: true, calibratedAt: '2026-11-10T15:45:00.000Z', sourceId: null, sourceName: null,
      activity: [
        act('d1', '2026-11-24T12:55:00.000Z', 'sincronizacao', 'Lote de 3 batidas recebido'),
        act('d2', '2026-11-10T15:45:00.000Z', 'calibracao', 'Calibração aplicada'),
      ],
    },
  ];
}

let rows: Row[] = seedRows();
let sessions = new Map<EntityId, Session>();

/** Volta o mock ao estado inicial (usado pelos testes). */
export function resetMockDevices() {
  rows = seedRows();
  sessions = new Map();
}

const find = (id: EntityId): Row => {
  const row = rows.find((r) => r.device.id === id);
  if (!row) throw mockNotFound();
  return row;
};

const settingsOf = (r: Row): DeviceCalibrationSettings => ({
  recognitionThreshold: r.overrides.recognitionThreshold,
  livenessThreshold: r.overrides.livenessThreshold,
  effectiveRecognitionThreshold: r.overrides.recognitionThreshold ?? DEFAULT_RECOGNITION,
  effectiveLivenessThreshold: r.overrides.livenessThreshold ?? DEFAULT_LIVENESS,
  isCalibrated: r.isCalibrated,
  calibratedAt: r.calibratedAt,
  calibrationSourceDeviceId: r.sourceId,
  calibrationSourceName: r.sourceName,
});

const push = (r: Row, type: DeviceActivity['type'], description: string) => {
  r.activity.unshift(act(mockId(), MOCK_NOW, type, description));
};

/** Chave fictícia no formato gk_ + 40 hex (160 bits). Nada guarda a chave: só devolve. */
const fakeKey = () => {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(20));
  return `gk_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
};

const duplicateName = (establishmentId: EntityId, name: string, exceptId?: EntityId) =>
  rows.some((r) => r.device.establishmentId === establishmentId && r.device.id !== exceptId && r.device.name.trim().toLowerCase() === name.trim().toLowerCase());

const dupError = () => mockFail(409, 'APARELHO_NOME_DUPLICADO', 'Já existe um totem com este nome neste estabelecimento.', [{ path: 'name', message: 'Já existe um totem com este nome neste estabelecimento.' }]);

/** Histograma determinístico: mesma pessoa perto de 0,62 e pessoas diferentes perto de 1,28. */
function histogram(): CalibrationSessionResult['distanceHistogram'] {
  const out: CalibrationSessionResult['distanceHistogram'] = [];
  for (let i = 0; i <= 16; i++) {
    const bucket = Math.round((0.3 + i * 0.1) * 10) / 10;
    const genuine = Math.round(180 * Math.exp(-(((bucket - 0.62) / 0.14) ** 2) / 2));
    const impostor = Math.round(260 * Math.exp(-(((bucket - 1.28) / 0.2) ** 2) / 2));
    out.push({ bucket, genuine, impostor });
  }
  return out;
}

/** Resultado determinístico que o totem simulado calcularia. */
function computedResult(row: Row): CalibrationSessionResult {
  const eff = settingsOf(row);
  return {
    current: { recognitionThreshold: eff.effectiveRecognitionThreshold, livenessThreshold: eff.effectiveLivenessThreshold },
    proposed: { recognitionThreshold: 0.95, livenessThreshold: 0.9 },
    qualityScore: 86,
    recommendations: [
      'Boa separação entre rostos da mesma pessoa e de pessoas diferentes neste totem.',
      'O limiar proposto é mais rígido que o padrão. Abaixo dele a batida continua registrada e vai para revisão.',
      'Refaça a calibração se a iluminação do local mudar.',
    ],
    distanceHistogram: histogram(),
  };
}

const finishSession = (id: EntityId) => {
  const entry = sessions.get(id);
  if (!entry || entry.session.status !== 'aguardando') return;
  entry.session = { ...entry.session, status: 'calculada', computedAt: systemClock.now().toISOString(), result: computedResult(find(id)) };
};

/** Ajuda de teste e de demonstração: o totem terminou as capturas e a sessão fica calculada. */
export function completeMockCalibration(id: EntityId) {
  finishSession(id);
}

export const mockDevicesApi: DevicesApi = {
  list: async (q) => {
    await delay();
    if (q.establishmentId && !mockEstablishments.some((e) => e.id === q.establishmentId)) throw mockNotFound();
    const list = rows
      .filter((r) => (!q.establishmentId || r.device.establishmentId === q.establishmentId) && (!q.connection || r.device.connection === q.connection) && matchesQuery(q.q, r.device.name))
      .map((r) => r.device)
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    return clone(list);
  },
  get: async (id) => {
    await delay();
    return clone(find(id).device);
  },
  create: async (body) => {
    await delay();
    if (!mockEstablishments.some((e) => e.id === body.establishmentId)) throw mockNotFound();
    const name = body.name.trim();
    if (name.length < 2) throw mockFail(422, 'VALIDATION', 'Dados inválidos', [{ path: 'name', message: 'Informe o nome do totem (mínimo de 2 letras).' }]);
    if (duplicateName(body.establishmentId, name)) throw dupError();
    const device: Device = {
      id: mockId(), establishmentId: body.establishmentId, name, isActive: true, connection: 'offline', lastSyncAt: null,
      pendingPunches: 0, appVersion: null, calibrationState: 'padrao', hasPunches: false, keyPrefix: null, createdAt: MOCK_NOW,
    };
    const row: Row = { device, overrides: { recognitionThreshold: null, livenessThreshold: null }, isCalibrated: false, calibratedAt: null, sourceId: null, sourceName: null, activity: [] };
    push(row, 'ativado', 'Totem cadastrado e ativado');
    rows.push(row);
    const apiKey = fakeKey();
    device.keyPrefix = apiKey.slice(0, 8);
    return { device: clone(device), apiKey };
  },
  update: async (id, body) => {
    await delay();
    const row = find(id);
    if (body.name !== undefined) {
      const name = body.name.trim();
      if (name.length < 2) throw mockFail(422, 'VALIDATION', 'Dados inválidos', [{ path: 'name', message: 'Informe o nome do totem (mínimo de 2 letras).' }]);
      if (duplicateName(row.device.establishmentId, name, id)) throw dupError();
      row.device.name = name;
    }
    if (body.isActive !== undefined && body.isActive !== row.device.isActive) {
      row.device.isActive = body.isActive;
      row.device.connection = body.isActive ? 'offline' : 'inativo';
      push(row, body.isActive ? 'ativado' : 'desativado', body.isActive ? 'Totem reativado' : 'Totem desativado');
      if (!body.isActive) sessions.delete(id);
    }
    return clone(row.device);
  },
  remove: async (id) => {
    await delay();
    const row = find(id);
    if (row.device.hasPunches) {
      throw mockFail(409, 'APARELHO_COM_BATIDAS', 'Este totem já registrou batidas e não pode ser excluído. Desative-o.');
    }
    rows = rows.filter((r) => r.device.id !== id);
    sessions.delete(id);
  },
  regenerateKey: async (id) => {
    await delay();
    const row = find(id);
    push(row, 'chave_regenerada', 'Chave de acesso regenerada');
    const apiKey = fakeKey();
    row.device.keyPrefix = apiKey.slice(0, 8);
    return { device: clone(row.device), apiKey };
  },
  activity: async (id) => {
    await delay();
    return clone(find(id).activity);
  },
  calibration: async (id) => {
    await delay();
    return settingsOf(find(id));
  },
  calibrationSession: async (id) => {
    await delay(100);
    find(id);
    const entry = sessions.get(id);
    if (!entry) return null;
    if (entry.session.status === 'aguardando' && systemClock.now().getTime() - entry.startedMs >= SIMULATED_TOTEM_MS) finishSession(id);
    return clone(sessions.get(id)?.session ?? null);
  },
  startCalibration: async (id) => {
    await delay();
    const row = find(id);
    if (!row.device.isActive) throw mockFail(409, 'APARELHO_INATIVO', 'Ative o totem para poder calibrar.');
    if (sessions.has(id)) throw mockFail(409, 'CALIBRACAO_EM_ANDAMENTO', 'Já existe uma calibração em andamento neste totem.');
    const now = systemClock.now();
    const session: CalibrationSession = { id: mockId(), status: 'aguardando', startedAt: now.toISOString(), computedAt: null, result: null };
    sessions.set(id, { session, startedMs: now.getTime() });
    return clone(session);
  },
  discardCalibration: async (id) => {
    await delay();
    find(id);
    sessions.delete(id);
  },
  applyCalibration: async (id, proposed) => {
    await delay();
    const row = find(id);
    const details: { path: string; message: string }[] = [];
    if (!(proposed.recognitionThreshold >= 0.3 && proposed.recognitionThreshold <= 2)) details.push({ path: 'recognitionThreshold', message: 'O limiar de reconhecimento deve ficar entre 0,30 e 2,00.' });
    if (!(proposed.livenessThreshold >= 0.5 && proposed.livenessThreshold <= 0.95)) details.push({ path: 'livenessThreshold', message: 'O limiar de vivacidade deve ficar entre 0,50 e 0,95.' });
    if (details.length) throw mockFail(422, 'VALIDATION', 'Dados inválidos', details);
    row.overrides = { recognitionThreshold: proposed.recognitionThreshold, livenessThreshold: proposed.livenessThreshold };
    row.isCalibrated = true;
    row.calibratedAt = systemClock.now().toISOString();
    row.sourceId = null;
    row.sourceName = null;
    row.device.calibrationState = 'calibrado';
    sessions.delete(id);
    push(row, 'calibracao', 'Calibração aplicada');
    return settingsOf(row);
  },
  resetCalibration: async (id) => {
    await delay();
    const row = find(id);
    row.overrides = { recognitionThreshold: null, livenessThreshold: null };
    row.isCalibrated = false;
    row.calibratedAt = null;
    row.sourceId = null;
    row.sourceName = null;
    row.device.calibrationState = 'padrao';
    sessions.delete(id);
    push(row, 'calibracao', 'Calibração voltou ao padrão da conta');
    return settingsOf(row);
  },
  copyCalibration: async (id, sourceDeviceId) => {
    await delay();
    const row = find(id);
    const source = find(sourceDeviceId);
    // Só de totem do mesmo estabelecimento; fora disso responde como se não existisse.
    if (source.device.id === row.device.id || source.device.establishmentId !== row.device.establishmentId) throw mockNotFound();
    row.overrides = { ...source.overrides };
    row.isCalibrated = source.isCalibrated;
    row.calibratedAt = source.isCalibrated ? MOCK_NOW : null;
    row.sourceId = source.device.id;
    row.sourceName = source.device.name;
    row.device.calibrationState = source.isCalibrated ? 'calibrado' : 'padrao';
    sessions.delete(id);
    push(row, 'calibracao', `Calibração copiada de ${source.device.name}`);
    return settingsOf(row);
  },
};
