/**
 * Mock do totem web (NEXT_PUBLIC_USE_MOCKS=true). Chave aceita: qualquer uma que comece com `gk_demo`.
 * Cadastro: CPF 00000000101 + PIN 483920 funcionam; qualquer outro par responde o erro genérico.
 * Controles de desenvolvimento (`kioskMockControls`) só aparecem na tela quando os mocks estão ligados.
 */
import { systemClock } from '../../clock';
import { toApiError } from '../errors';
import type { KioskApi, KioskClientOptions, KioskContext, PunchResult } from '../kiosk';
import { delay } from './runtime';

export const MOCK_KIOSK_CPF = '00000000101';
export const MOCK_KIOSK_PIN = '483920';
export const MOCK_KIOSK_KEY_PREFIX = 'gk_demo';

export type MockPunchOutcome = 'registered' | 'not_recognized' | 'liveness_failed';

/** Estado mutável do mock (a tela de desenvolvimento mexe aqui). */
export const kioskMockControls: { calibrationWaiting: boolean; punchOutcome: MockPunchOutcome } = {
  calibrationWaiting: false,
  punchOutcome: 'registered',
};

const SESSION_ID = '7001';

export function createMockKioskApi(opts: KioskClientOptions = {}): KioskApi {
  const { keyStore, clock = systemClock } = opts;
  let seq = 0;

  async function guard() {
    await delay(200);
    const key = keyStore?.get() ?? null;
    if (!key || !key.startsWith(MOCK_KIOSK_KEY_PREFIX)) {
      opts.onKeyRejected?.();
      throw toApiError(401, { code: 'CHAVE_APARELHO_INVALIDA', error: 'Chave do aparelho inválida.' });
    }
  }

  return {
    async context() {
      await guard();
      const ctx: KioskContext = {
        device: { id: '501', name: 'Totem da portaria' },
        establishment: { id: '1', name: 'Fazenda Boa Vista' },
        calibration: kioskMockControls.calibrationWaiting ? { sessionId: SESSION_ID, status: 'aguardando' } : null,
        serverTime: clock.now().toISOString(),
      };
      return ctx;
    },
    async enroll(form) {
      await guard();
      const photos = form.getAll('photos');
      const ok =
        form.get('cpf') === MOCK_KIOSK_CPF && form.get('pin') === MOCK_KIOSK_PIN && form.get('consentAccepted') === 'true' && photos.length >= 1;
      if (!ok) throw toApiError(401, { code: 'CPF_OU_PIN_INVALIDO', error: 'CPF ou PIN inválido.' });
      return { enrolledAt: clock.now().toISOString(), imagesProcessed: photos.length };
    },
    async submitCalibration(form) {
      await guard();
      if (form.get('sessionId') !== SESSION_ID) throw toApiError(404, { code: 'NOT_FOUND' });
      kioskMockControls.calibrationWaiting = false;
      return { status: 'calculada' };
    },
    async punch(image) {
      await guard();
      if (!(image instanceof Blob)) throw toApiError(400, { code: 'INVALID_IMAGE', error: 'Imagem inválida' });
      seq += 1;
      const outcome = kioskMockControls.punchOutcome;
      if (outcome !== 'registered') return { outcome: 'fallback_required', reason: outcome, warnings: [] } satisfies PunchResult;
      return {
        outcome: 'registered',
        receiptId: '00000000-0000-4000-8000-000000000001',
        jobId: `501-${seq}`,
        markedAt: clock.now().toISOString(),
        warnings: [],
        employeeFirstName: 'João',
      } satisfies PunchResult;
    },
    async punchJob(jobId) {
      await guard();
      const now = clock.now().toISOString();
      return { jobId, receiptId: '00000000-0000-4000-8000-000000000001', status: 'processado', nsr: 1, markedAt: now, processedAt: now };
    },
  };
}
