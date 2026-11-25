'use client';
/**
 * Totem web público (`/totem`): sem login do portal, a identidade do aparelho é a chave guardada neste navegador.
 * Telas: chave → início → (registrar ponto | cadastrar rosto | ajuste pedido pelo administrador).
 * Contrato: docs/totem-contrato.md.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createKioskApi, isKeyRejected, keyPrefix, kioskKeyStore, type KioskApi, type KioskContext, type KioskKeyStore } from '@/lib/api/kiosk';
import { useClock } from '@/lib/clock-context';
import { CalibrationFlow } from './CalibrationFlow';
import { COPY } from './copy';
import { EnrollFlow } from './EnrollFlow';
import { KeySetup } from './KeySetup';
import { KioskFrame } from './KioskFrame';
import { KioskHome } from './KioskHome';
import { PunchFlow } from './PunchFlow';

type Screen = 'booting' | 'setup' | 'home' | 'punch' | 'enroll' | 'calibration';

export const CONTEXT_POLL_MS = 15_000;
const CONTEXT_KEY = ['kiosk', 'context'] as const;

export function KioskApp({ api: injected, keyStore = kioskKeyStore }: { api?: KioskApi; keyStore?: KioskKeyStore }) {
  const clock = useClock();
  const queryClient = useQueryClient();
  const [screen, setScreen] = useState<Screen>('booting');
  const [key, setKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Sessões de ajuste que a pessoa dispensou ou já enviou: não reabrir até recarregar. */
  const [dismissed, setDismissed] = useState<readonly string[]>([]);

  // Chave rejeitada: apaga, esquece o contexto e volta para a tela da chave. Idempotente.
  const rejectKey = useCallback(() => {
    keyStore.clear();
    queryClient.removeQueries({ queryKey: CONTEXT_KEY });
    setKey(null);
    setNotice(COPY.setup.rejected);
    setScreen('setup');
  }, [keyStore, queryClient]);
  const rejectRef = useRef(rejectKey);
  rejectRef.current = rejectKey;

  const api = useMemo(() => injected ?? createKioskApi({ clock, keyStore, onKeyRejected: () => rejectRef.current() }), [injected, clock, keyStore]);

  useEffect(() => {
    const stored = keyStore.get();
    setKey(stored);
    setScreen(stored ? 'home' : 'setup');
  }, [keyStore]);

  const enabled = key !== null && screen !== 'booting' && screen !== 'setup';
  const ctx = useQuery({
    queryKey: CONTEXT_KEY,
    queryFn: ({ signal }) => api.context(signal),
    enabled,
    refetchInterval: CONTEXT_POLL_MS,
    refetchOnWindowFocus: true,
    retry: false,
    staleTime: 0,
  });

  useEffect(() => {
    if (ctx.error && isKeyRejected(ctx.error)) rejectKey();
  }, [ctx.error, rejectKey]);

  // O administrador pediu o ajuste: o totem entra sozinho no assistente (só a partir do início, sem interromper um ponto).
  const waiting = ctx.data?.calibration?.status === 'aguardando' ? ctx.data.calibration.sessionId : null;
  useEffect(() => {
    if (screen === 'home' && waiting && !dismissed.includes(waiting)) setScreen('calibration');
  }, [screen, waiting, dismissed]);

  const goHome = useCallback(() => setScreen('home'), []);
  const dismiss = useCallback(
    (id: string) => {
      setDismissed((d) => [...d, id]);
      setScreen('home');
      void ctx.refetch();
    },
    [ctx],
  );

  const connected = (context: KioskContext) => {
    setKey(keyStore.get());
    setNotice(null);
    queryClient.setQueryData(CONTEXT_KEY, context);
    setScreen('home');
  };

  const disconnect = () => {
    keyStore.clear();
    queryClient.removeQueries({ queryKey: CONTEXT_KEY });
    setKey(null);
    setNotice(null);
    setDismissed([]);
    setScreen('setup');
  };

  if (screen === 'booting') return <KioskFrame><span className="sr-only" role="status">Carregando…</span></KioskFrame>;
  if (screen === 'setup') return <KeySetup api={api} keyStore={keyStore} notice={notice} onConnected={connected} />;
  if (screen === 'punch') return <PunchFlow api={api} onDone={goHome} onKeyRejected={rejectKey} />;
  if (screen === 'enroll') return <EnrollFlow api={api} onDone={goHome} onKeyRejected={rejectKey} />;
  if (screen === 'calibration' && waiting) {
    return <CalibrationFlow api={api} sessionId={waiting} onSubmitted={() => dismiss(waiting)} onCancel={() => dismiss(waiting)} onKeyRejected={rejectKey} />;
  }

  const offline = ctx.isError && !isKeyRejected(ctx.error);
  return (
    <KioskHome
      context={ctx.data}
      offline={offline}
      keyPrefix={keyPrefix(key)}
      onRetry={() => void ctx.refetch()}
      onPunch={() => setScreen('punch')}
      onEnroll={() => setScreen('enroll')}
      onDisconnect={disconnect}
    />
  );
}
