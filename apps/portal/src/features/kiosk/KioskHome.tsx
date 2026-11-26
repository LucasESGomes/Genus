'use client';
// Adaptado da tela de descanso de visage/frontend/src/app/totem/page.tsx (fonte somente leitura)
import { Key, UserCirclePlus, UserFocus, WifiSlash } from '@phosphor-icons/react';
import { motion } from 'framer-motion';
import { useRef } from 'react';
import { BrandMark } from '@/components/shell/BrandMark';
import type { KioskContext } from '@/lib/api/kiosk';
import { COPY } from './copy';
import { KioskClock } from './KioskClock';

/** Toques seguidos na marca que abrem o painel escondido do aparelho. */
const SECRET_TAPS = 5;
const TAP_WINDOW_MS = 1500;

export function KioskHome({ context, offline = false, onRetry, onPunch, onEnroll, onPanel, onSetup }: {
  context?: KioskContext;
  offline?: boolean;
  onRetry?: () => void;
  onPunch: () => void;
  onEnroll: () => void;
  onPanel?: () => void;
  /** Aparelho sem chave: mostra "Configurar este totem". */
  onSetup?: () => void;
}) {
  const taps = useRef({ count: 0, last: 0 });
  const tap = (at: number) => {
    const t = taps.current;
    t.count = at - t.last > TAP_WINDOW_MS ? 1 : t.count + 1;
    t.last = at;
    if (t.count >= SECRET_TAPS) {
      t.count = 0;
      onPanel?.();
    }
  };
  const big = 'flex min-h-[64px] flex-1 cursor-pointer items-center justify-center gap-3 rounded-xl px-5 py-4 text-lg font-semibold whitespace-nowrap transition-colors';

  return (
    <motion.main
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className="flex min-h-dvh touch-manipulation flex-col items-center justify-between gap-6 bg-white px-6 pt-8 pb-8 select-none md:pt-[7vh] md:pb-12"
    >
      <button type="button" onClick={(e) => tap(e.timeStamp)} aria-label={COPY.brand} className="flex cursor-default items-center gap-3 border-0 bg-transparent p-2 text-ink focus:outline-none">
        <BrandMark className="h-9 w-9" />
        <span className="text-2xl font-bold tracking-tight">{COPY.brand}</span>
      </button>

      {offline && (
        <div role="alert" className="flex w-full max-w-xl flex-wrap items-center justify-between gap-3 rounded-xl border border-warn bg-warn-bg px-4 py-3 text-warn">
          <span className="flex items-center gap-2 text-base font-semibold"><WifiSlash size={22} aria-hidden />{COPY.home.offline}. {COPY.home.offlineText}</span>
          <button type="button" onClick={onRetry} className="min-h-12 cursor-pointer rounded-xl border border-warn bg-white px-4 font-semibold text-warn">{COPY.home.retry}</button>
        </div>
      )}

      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center md:gap-5">
        <KioskClock />
        <p className="m-0 text-lg text-ink-2 md:text-xl">{context?.device.name ?? COPY.home.subtitle}</p>
        <h1 className="m-0 inline-flex items-center gap-2 rounded-full border border-line bg-tint px-4 py-2 text-sm font-medium text-brand">
          <span aria-hidden className="h-2 w-2 rounded-full bg-brand" />
          {context?.establishment.name ?? COPY.punch.title}
        </h1>
      </div>

      <div className="flex w-full max-w-xl shrink-0 flex-col items-center gap-4 md:gap-5">
        <div className="flex w-full flex-col gap-3 sm:flex-row">
          <motion.button type="button" whileTap={{ scale: 0.98 }} onClick={onPunch} className={`${big} border-0 bg-brand text-white shadow-md hover:bg-brand-hover`}>
            <UserFocus size={26} aria-hidden />
            {COPY.home.punch}
          </motion.button>
          <motion.button type="button" whileTap={{ scale: 0.98 }} onClick={onEnroll} className={`${big} border border-line-strong bg-white text-ink shadow-xs hover:border-brand`}>
            <UserCirclePlus size={26} aria-hidden />
            {COPY.home.enroll}
          </motion.button>
        </div>
        {onSetup && (
          <button type="button" onClick={onSetup} className="flex cursor-pointer items-center gap-2 border-0 bg-transparent text-sm font-medium text-muted hover:text-ink">
            <Key size={15} aria-hidden />
            {COPY.home.setup}
          </button>
        )}
        <p className="m-0 text-xs tracking-wide text-muted">{COPY.home.footer}</p>
      </div>
    </motion.main>
  );
}
