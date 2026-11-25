'use client';
import { keepPreviousData } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { CalibrationThresholds, CreateDeviceBody, DeviceListQuery, EntityId, UpdateDeviceBody } from '@/lib/api/contracts';
import { useApiMutation, useApiQuery } from '@/lib/query/hooks';

/** A chave de acesso sai da mutação por este retorno de chamada e nunca entra no cache do React Query. */
export interface KeyReveal {
  deviceName: string;
  apiKey: string;
}

export const useDeviceList = (q: DeviceListQuery, enabled = true) =>
  useApiQuery('devices', { list: true, ...q }, (api, signal) => api.devices.list(q, signal), { enabled, placeholderData: keepPreviousData });

export const useDeviceDetail = (id: EntityId | null, enabled = true) =>
  useApiQuery('devices', { detail: id }, (api, signal) => (id ? api.devices.get(id, signal) : Promise.reject(new Error('sem id'))), { enabled: enabled && id !== null });

export const useCreateDevice = (onKey: (k: KeyReveal) => void) =>
  useApiMutation(
    async (api, body: CreateDeviceBody) => {
      const { device, apiKey } = await api.devices.create(body);
      onKey({ deviceName: device.name, apiKey });
      return device;
    },
    { invalidates: ['devices'] },
  );

export const useRegenerateKey = (onKey: (k: KeyReveal) => void) =>
  useApiMutation(
    async (api, id: EntityId) => {
      const { device, apiKey } = await api.devices.regenerateKey(id);
      onKey({ deviceName: device.name, apiKey });
      return device;
    },
    { invalidates: ['devices'] },
  );

export const useUpdateDevice = () =>
  useApiMutation((api, v: { id: EntityId; body: UpdateDeviceBody }) => api.devices.update(v.id, v.body), { invalidates: ['devices'] });

export const useRemoveDevice = () => useApiMutation((api, id: EntityId) => api.devices.remove(id), { invalidates: ['devices', 'calibration'] });

export const useStartCalibration = () => useApiMutation((api, id: EntityId) => api.devices.startCalibration(id), { invalidates: ['calibration'] });
export const useDiscardCalibration = () => useApiMutation((api, id: EntityId) => api.devices.discardCalibration(id), { invalidates: ['calibration'] });
export const useApplyCalibration = () =>
  useApiMutation((api, v: { id: EntityId; proposed: CalibrationThresholds }) => api.devices.applyCalibration(v.id, v.proposed), { invalidates: ['calibration', 'devices'] });
export const useResetCalibration = () => useApiMutation((api, id: EntityId) => api.devices.resetCalibration(id), { invalidates: ['calibration', 'devices'] });
export const useCopyCalibration = () =>
  useApiMutation((api, v: { id: EntityId; sourceDeviceId: EntityId }) => api.devices.copyCalibration(v.id, v.sourceDeviceId), { invalidates: ['calibration', 'devices'] });

/** Aba visível? Sem isso o acompanhamento da calibração continuaria consultando com a aba escondida. */
export function usePageVisible() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== 'hidden');
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return visible;
}
