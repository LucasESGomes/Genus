'use client';
// Copiado de visage/frontend/src/components/totem/TotemStage.tsx (fonte somente leitura), com a marca e as cores do Genus.
import { CameraSlash, Flashlight, Lock, X } from '@phosphor-icons/react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';
import { BrandMark } from '@/components/shell/BrandMark';
import type { CameraStatus } from '@/features/totems/camera/useTotemCamera';
import { cn } from '@/lib/utils';
import { COPY } from './copy';

export type ResultKind = 'success' | 'warning' | 'error';

export interface StageResult {
  kind: ResultKind;
  title: string;
  message?: string;
}

/** A guia oval é o indicador central: branca em repouso, azul pulsando com rosto, verde/âmbar/vermelha no desfecho. */
export type GuideState = 'neutral' | 'detecting' | 'processing' | ResultKind;

/** Retrato: vídeo em tela cheia. Paisagem: caixa 16:9 centralizada. */
export function StageShell({ children, flashlightOn = false }: { children: ReactNode; flashlightOn?: boolean }) {
  const bg = flashlightOn ? 'bg-white' : 'bg-brand-active';
  return (
    <div className={cn('fixed inset-0 z-40 flex items-center justify-center transition-colors duration-300', bg)}>
      <div
        className={cn(
          'relative h-full w-full overflow-hidden transition-colors duration-300',
          bg,
          'landscape:aspect-video landscape:h-auto landscape:w-[min(88vw,160svh)]',
          'landscape:rounded-3xl landscape:border landscape:border-white/10 landscape:shadow-xl',
        )}
      >
        {children}
      </div>
    </div>
  );
}

/** Indicador superior em vidro + barras finas de progresso. */
export function StageHeader({ icon, title, subtitle, chip, onClose, closeLabel = 'Fechar', segments, fraction, flashlightOn = false }: {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  chip?: ReactNode;
  onClose?: () => void;
  closeLabel?: string;
  segments?: { total: number; completed: number };
  /** Barra contínua 0–1 (tempo restante). */
  fraction?: number;
  flashlightOn?: boolean;
}) {
  const track = flashlightOn ? 'bg-brand/15' : 'bg-white/20';
  const fill = flashlightOn ? 'bg-brand' : 'bg-white';
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-30 p-3 md:p-5">
      <div className="mx-auto flex max-w-2xl flex-col gap-2">
        <div
          className={cn(
            'pointer-events-auto flex items-center gap-3 rounded-2xl border py-2.5 pr-2.5 pl-3 shadow-lg backdrop-blur-xl transition-colors duration-300',
            flashlightOn ? 'border-brand/10 bg-brand/5 text-brand' : 'border-white/15 bg-white/10 text-white',
          )}
        >
          <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', flashlightOn ? 'bg-brand/10' : 'bg-white/10')}>{icon}</span>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="m-0 truncate text-sm font-semibold">{title}</p>
            {subtitle && <p className="m-0 truncate text-xs opacity-70">{subtitle}</p>}
          </div>
          {chip}
          {onClose && (
            <button type="button" onClick={onClose} aria-label={closeLabel} className="cursor-pointer rounded-xl border-0 bg-transparent p-2.5 text-inherit opacity-75 hover:opacity-100">
              <X size={18} aria-hidden />
            </button>
          )}
        </div>
        {segments && segments.total > 1 && (
          <div className="flex gap-1.5 px-0.5" aria-hidden>
            {Array.from({ length: segments.total }, (_, i) => (
              <span key={i} className={cn('h-1 flex-1 overflow-hidden rounded-full', track)}>
                <span className={cn('block h-full rounded-full transition-[width] duration-500 ease-out', fill, i < segments.completed ? 'w-full' : 'w-0')} />
              </span>
            ))}
          </div>
        )}
        {fraction !== undefined && (
          <div className={cn('h-1 overflow-hidden rounded-full', track)} aria-hidden>
            <span className={cn('block h-full rounded-full transition-[width] duration-1000 ease-linear', fill)} style={{ width: `${Math.max(0, Math.min(1, fraction)) * 100}%` }} />
          </div>
        )}
      </div>
    </div>
  );
}

const GUIDE: Record<GuideState, { border: string; glow: string }> = {
  neutral: { border: 'rgba(255,255,255,0.7)', glow: 'rgba(255,255,255,0)' },
  detecting: { border: '#8aa9cf', glow: 'rgba(138,169,207,0.55)' },
  processing: { border: '#8aa9cf', glow: 'rgba(138,169,207,0.7)' },
  success: { border: '#4ade80', glow: 'rgba(74,222,128,0.6)' },
  warning: { border: '#fbbf24', glow: 'rgba(251,191,36,0.45)' },
  error: { border: '#f87171', glow: 'rgba(248,113,113,0.6)' },
};

/** Compartilhado com a lanterna para o recorte alinhar. */
const OVAL_BOX = 'relative aspect-[3/4] h-[56%] max-h-[72%] portrait:h-auto portrait:max-h-none portrait:w-[70%] portrait:max-w-[420px]';
const SPRING = { type: 'spring', stiffness: 120, damping: 18 } as const;

/** Escurecimento (z-5) e anel (z-11) em camadas separadas: a lanterna (z-8) fica entre elas. */
export function FaceGuide({ state, scale = 1, blink = false }: { state: GuideState; scale?: number; blink?: boolean }) {
  const reduce = useReducedMotion();
  const s = GUIDE[state];
  const pulsing = !reduce && (blink || state === 'detecting' || state === 'processing');
  const duration = blink ? 0.4 : state === 'processing' ? 1.1 : 1.7;
  return (
    <>
      <div aria-hidden className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center">
        <motion.div animate={{ scale }} transition={SPRING} className={OVAL_BOX}>
          <div className="absolute inset-0 rounded-[50%]" style={{ boxShadow: '0 0 0 9999px rgba(8,13,24,0.42)' }} />
        </motion.div>
      </div>
      <div aria-hidden className="pointer-events-none absolute inset-0 z-[11] flex items-center justify-center">
        <motion.div animate={{ scale }} transition={SPRING} className={OVAL_BOX}>
          <motion.div
            data-guide={state}
            className="absolute inset-0 rounded-[50%] border-[2.5px] border-solid"
            style={{ borderColor: s.border, transition: 'border-color 0.3s ease' }}
            animate={{
              boxShadow: pulsing ? [`0 0 0px 0px ${s.glow}`, `0 0 36px 5px ${s.glow}`, `0 0 0px 0px ${s.glow}`] : `0 0 26px 2px ${s.glow}`,
              opacity: pulsing ? [0.6, 1, 0.6] : 1,
            }}
            transition={pulsing ? { duration, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.35 }}
          />
        </motion.div>
      </div>
    </>
  );
}

/** "Lanterna" de tela: acende em branco a área em volta do oval. Sempre manual. */
export function FlashlightOverlay({ active, scale = 1 }: { active: boolean; scale?: number }) {
  return (
    <div aria-hidden className={cn('pointer-events-none absolute inset-0 z-[8] flex items-center justify-center transition-opacity duration-300', active ? 'opacity-100' : 'opacity-0')}>
      <motion.div animate={{ scale }} transition={SPRING} className={OVAL_BOX}>
        <div className="absolute inset-0 rounded-[50%]" style={{ boxShadow: '0 0 0 9999px #fff' }} />
      </motion.div>
    </div>
  );
}

export function FlashlightButton({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={active ? 'Desligar lanterna de tela' : 'Ligar lanterna de tela'}
      className={cn(
        'pointer-events-auto flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full border transition-colors',
        active ? 'border-brand bg-brand text-white' : 'border-white/20 bg-white/10 text-white/85 hover:bg-white/20',
      )}
    >
      <Flashlight size={16} aria-hidden />
    </button>
  );
}

const OVERLAY = {
  success: { bg: 'bg-gradient-to-b from-[#14532d]/95 via-[#15803d]/94 to-[#052e16]/96', path: 'M5 13l4 4L19 7' },
  error: { bg: 'bg-gradient-to-b from-[#7f1d1d]/95 via-[#b91c1c]/94 to-[#450a0a]/96', path: 'M6 18L18 6M6 6l12 12' },
};

/** Desfecho em tela cheia: ícone desenhado, anéis pulsantes e textos em cascata. Avisos ficam na base. */
export function StageResultOverlay({ result, children }: { result: StageResult | null; children?: ReactNode }) {
  const reduce = useReducedMotion();
  const kind = result && result.kind !== 'warning' ? result.kind : null;
  return (
    <AnimatePresence>
      {kind && result && (
        <motion.div
          key={`overlay-${kind}-${result.title}`}
          role={kind === 'success' ? 'status' : 'alert'}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.32 }}
          className={cn('absolute inset-0 z-40 flex flex-col items-center justify-center gap-6 px-8 text-center backdrop-blur-sm', OVERLAY[kind].bg)}
        >
          <div className="relative flex items-center justify-center" aria-hidden>
            {!reduce &&
              [0, 1].map((i) => (
                <motion.span
                  key={i}
                  className="absolute h-28 w-28 rounded-full border-2 border-white/35"
                  initial={{ scale: 0.7, opacity: 0 }}
                  animate={{ scale: [0.75, 2], opacity: [0.5, 0] }}
                  transition={{ duration: 1.7, delay: 0.3 + i * 0.6, repeat: Infinity, ease: 'easeOut' }}
                />
              ))}
            <motion.span
              initial={{ scale: 0.3, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 260, damping: 15, delay: 0.05 }}
              className="flex h-28 w-28 items-center justify-center rounded-full border border-white/30 bg-white/15 backdrop-blur-md"
            >
              <svg className="h-14 w-14" viewBox="0 0 24 24" fill="none">
                <motion.path
                  d={OVERLAY[kind].path}
                  stroke="#fff"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ delay: 0.28, duration: 0.5, ease: 'easeOut' }}
                />
              </svg>
            </motion.span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <motion.h2 initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.22 }} className="m-0 max-w-xl text-3xl font-bold tracking-tight text-balance text-white md:text-4xl">
              {result.title}
            </motion.h2>
            {result.message && (
              <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.34 }} className="m-0 max-w-md text-lg leading-relaxed text-white/85">
                {result.message}
              </motion.p>
            )}
          </div>
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Texto de status na base do palco, sempre acima da marca. */
export function StageBottom({ contentKey, title, subtitle, heading = false, children }: {
  contentKey: string;
  title: string;
  subtitle?: string;
  heading?: boolean;
  children?: ReactNode;
}) {
  const Title = heading ? 'h1' : 'p';
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col items-center gap-4 bg-gradient-to-t from-brand-active/90 via-brand-active/40 to-transparent px-5 pt-16 pb-3">
      <div role="status" aria-live="polite" className="grid w-full max-w-2xl place-items-center text-center">
        {/* Sem mode="wait": o totem não pode travar se a saída não animar. */}
        <AnimatePresence initial={false}>
          <motion.div
            key={contentKey}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.25 }}
            className="col-start-1 row-start-1 flex flex-col items-center gap-1.5"
          >
            <Title className="m-0 text-xl leading-snug font-bold text-balance text-white md:text-2xl">{title}</Title>
            {subtitle && <p className="m-0 max-w-md text-sm leading-relaxed text-white/70">{subtitle}</p>}
          </motion.div>
        </AnimatePresence>
      </div>
      {children && <div className="pointer-events-auto flex w-full max-w-sm flex-col gap-2">{children}</div>}
      <div className="flex items-center justify-center gap-2 text-white/60">
        <BrandMark className="scale-75 ring-1 ring-white/30" />
        <span className="text-xs font-semibold tracking-wide">{COPY.brand}</span>
      </div>
    </div>
  );
}

/** Botão translúcido sobre o vídeo. */
export const STAGE_BUTTON =
  'flex min-h-[52px] w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/30 bg-white/10 px-6 text-base font-semibold text-white backdrop-blur-md transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-50';

/** Falha de câmera com nova tentativa; ocupa o palco inteiro. */
export function StageError({ status, onRetry }: { status: CameraStatus; onRetry: () => void }) {
  const message = status === 'insecure' ? COPY.camera.insecure : status === 'unsupported' ? COPY.camera.unsupported : COPY.camera.error;
  return (
    <div role="alert" className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 p-8 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-danger/25 text-[#f87171]">
        {status === 'insecure' ? <Lock size={28} aria-hidden /> : <CameraSlash size={28} aria-hidden />}
      </span>
      <p className="m-0 max-w-sm text-base font-medium text-white/85">{message}</p>
      {status === 'error' && (
        <div className="w-full max-w-xs">
          <button type="button" onClick={onRetry} className={STAGE_BUTTON}>{COPY.camera.retry}</button>
        </div>
      )}
    </div>
  );
}

export const cameraFailed = (status: CameraStatus) => status === 'error' || status === 'insecure' || status === 'unsupported';

/** Prévia espelhada como um espelho; a foto usa o quadro sem espelhar. */
export function StageVideo({ bind }: { bind: (el: HTMLVideoElement | null) => void }) {
  return <video ref={bind} autoPlay playsInline muted aria-label="Imagem da câmera" className="absolute inset-0 h-full w-full -scale-x-100 object-cover" />;
}
