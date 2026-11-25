/** Schemas Zod do módulo de aparelhos (totem), docs/totem-contrato.md §3.1. Nada de hash nem chave sai daqui. */
import { z } from 'zod';
import { positiveId } from '../../http/schemas';
import { LIVENESS_RANGE, RECOGNITION_RANGE } from './rules/calibration-result';

export const CONNECTIONS = ['online', 'offline', 'inativo'] as const;

export const listDevicesQuery = z.object({
  establishmentId: positiveId.optional(),
  connection: z.enum(CONNECTIONS).optional(),
});

const deviceName = z.string().trim().min(2).max(80);

export const createDeviceBody = z.object({ establishmentId: positiveId, name: deviceName });

export const updateDeviceBody = z
  .object({ name: deviceName, isActive: z.boolean() })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'envie ao menos um campo');

export const thresholdsBody = z.object({
  recognitionThreshold: z.number().min(RECOGNITION_RANGE.min).max(RECOGNITION_RANGE.max),
  livenessThreshold: z.number().min(LIVENESS_RANGE.min).max(LIVENESS_RANGE.max),
});

export const copyCalibrationBody = z.object({ sourceDeviceId: positiveId });

export const deviceDto = z.object({
  id: z.number(),
  establishmentId: z.number(),
  name: z.string(),
  isActive: z.boolean(),
  connection: z.enum(CONNECTIONS),
  lastSyncAt: z.string().nullable(),
  pendingPunches: z.number(),
  appVersion: z.string().nullable(),
  calibrationState: z.enum(['calibrado', 'padrao', 'desatualizado']),
  hasPunches: z.boolean(),
  keyPrefix: z.string().nullable(),
  createdAt: z.string(),
});
export type DeviceDto = z.infer<typeof deviceDto>;

export const deviceResponse = z.object({ data: deviceDto });
export const deviceListResponse = z.object({ data: z.array(deviceDto) });
export const deviceWithKeyResponse = z.object({ data: z.object({ device: deviceDto, apiKey: z.string() }) });

export const deviceActivityDto = z.object({ id: z.number(), type: z.string(), description: z.string(), createdAt: z.string() });
export const deviceActivityResponse = z.object({ data: z.array(deviceActivityDto) });

const thresholds = z.object({ recognitionThreshold: z.number(), livenessThreshold: z.number() });

export const calibrationSettingsDto = z.object({
  recognitionThreshold: z.number().nullable(),
  livenessThreshold: z.number().nullable(),
  effectiveRecognitionThreshold: z.number(),
  effectiveLivenessThreshold: z.number(),
  isCalibrated: z.boolean(),
  calibratedAt: z.string().nullable(),
  calibrationSourceDeviceId: z.number().nullable(),
  calibrationSourceName: z.string().nullable(),
});
export type CalibrationSettingsDto = z.infer<typeof calibrationSettingsDto>;
export const calibrationSettingsResponse = z.object({ data: calibrationSettingsDto });

export const calibrationSessionDto = z.object({
  id: z.number(),
  status: z.enum(['aguardando', 'calculada', 'aplicada', 'descartada', 'falhou']),
  startedAt: z.string(),
  computedAt: z.string().nullable(),
  result: z
    .object({
      current: thresholds,
      proposed: thresholds,
      qualityScore: z.number(),
      recommendations: z.array(z.string()),
      distanceHistogram: z.array(z.object({ bucket: z.number(), genuine: z.number(), impostor: z.number() })),
    })
    .nullable(),
  /** Só quando `status = 'falhou'`: motivo em pt-BR. */
  failureReason: z.string().nullable(),
});
export type CalibrationSessionDto = z.infer<typeof calibrationSessionDto>;
export const calibrationSessionResponse = z.object({ data: calibrationSessionDto });
export const calibrationSessionOrNullResponse = z.object({ data: calibrationSessionDto.nullable() });
