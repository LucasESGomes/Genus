/**
 * Totens (apps/api, docs/totem-contrato.md §3.1). A chave do aparelho vem só em create/regenerateKey, uma vez.
 * A calibração é conduzida pelo próprio totem (`/totem`): o painel inicia a sessão, acompanha e aplica ou descarta.
 */
import { qs, type ApiClient } from '../client';
import type {
  CalibrationSession, CalibrationThresholds, CreateDeviceBody, Device, DeviceActivity, DeviceCalibrationSettings, DeviceListQuery, DeviceWithKey,
  EntityId, Envelope, UpdateDeviceBody,
} from '../contracts';
import { apiPath } from '../ids';

const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export const devicesApi = (c: ApiClient) => ({
  /** `q` (nome do totem) ainda não existe no back: a lista é curta, então o filtro sem acento roda aqui. */
  list: async (q: DeviceListQuery, signal?: AbortSignal): Promise<Device[]> => {
    const list = (await c.get<Envelope<Device[]>>(`/portal/devices${qs({ establishmentId: q.establishmentId, connection: q.connection })}`, signal)).data;
    const needle = fold((q.q ?? '').trim());
    return needle ? list.filter((d) => fold(d.name).includes(needle)) : list;
  },
  get: async (id: EntityId, signal?: AbortSignal) => (await c.get<Envelope<Device>>(apiPath`/portal/devices/${id}`, signal)).data,
  create: async (body: CreateDeviceBody) => (await c.post<Envelope<DeviceWithKey>>('/portal/devices', body)).data,
  update: async (id: EntityId, body: UpdateDeviceBody) => (await c.patch<Envelope<Device>>(apiPath`/portal/devices/${id}`, body)).data,
  /** Recusado (409 APARELHO_COM_BATIDAS) se o aparelho tem batidas: desativar em vez de excluir. */
  remove: async (id: EntityId): Promise<void> => {
    await c.del<void>(apiPath`/portal/devices/${id}`);
  },
  regenerateKey: async (id: EntityId) => (await c.post<Envelope<DeviceWithKey>>(apiPath`/portal/devices/${id}/regenerate-key`)).data,
  activity: async (id: EntityId, signal?: AbortSignal) => (await c.get<Envelope<DeviceActivity[]>>(apiPath`/portal/devices/${id}/activity`, signal)).data,
  calibration: async (id: EntityId, signal?: AbortSignal) =>
    (await c.get<Envelope<DeviceCalibrationSettings>>(apiPath`/portal/devices/${id}/calibration`, signal)).data,
  /** Sessão em andamento (`aguardando` ou `calculada`); `null` quando não há. */
  calibrationSession: async (id: EntityId, signal?: AbortSignal) =>
    (await c.get<Envelope<CalibrationSession | null>>(apiPath`/portal/devices/${id}/calibration/session`, signal)).data,
  /** 409 CALIBRACAO_EM_ANDAMENTO · 409 APARELHO_INATIVO. */
  startCalibration: async (id: EntityId) => (await c.post<Envelope<CalibrationSession>>(apiPath`/portal/devices/${id}/calibration/start`)).data,
  /** A sessão vira `descartada`. */
  discardCalibration: async (id: EntityId): Promise<void> => {
    await c.del<void>(apiPath`/portal/devices/${id}/calibration/session`);
  },
  /** Aplica os valores propostos (a sessão `calculada` vira `aplicada`). */
  applyCalibration: async (id: EntityId, thresholds: CalibrationThresholds) =>
    (await c.put<Envelope<DeviceCalibrationSettings>>(apiPath`/portal/devices/${id}/calibration/settings`, thresholds)).data,
  /** Volta ao padrão da engine. */
  resetCalibration: async (id: EntityId) => (await c.del<Envelope<DeviceCalibrationSettings>>(apiPath`/portal/devices/${id}/calibration/settings`)).data,
  copyCalibration: async (id: EntityId, sourceDeviceId: EntityId) =>
    (await c.post<Envelope<DeviceCalibrationSettings>>(apiPath`/portal/devices/${id}/calibration/copy`, { sourceDeviceId })).data,
});
export type DevicesApi = ReturnType<typeof devicesApi>;
