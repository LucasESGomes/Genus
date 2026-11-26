'use client';
// Adaptado de visage/frontend/src/components/totem/CalibrationMode.tsx (fonte somente leitura)
//
// Coleta guiada em três etapas: o grupo que o totem vai reconhecer (3 poses por pessoa), o grupo de fora e o teste da
// foto na tela. Diferença para a Visage: as fotos ficam só em memória, saem do aparelho uma única vez (ao concluir) e
// são apagadas ao enviar ou cancelar.
import { ArrowLeft, ArrowRight, Camera, CaretRight, Check, DeviceMobile, Pulse, Users, X } from '@phosphor-icons/react';
import { motion } from 'framer-motion';
import { useState, type ReactNode } from 'react';
import { isKeyRejected, type KioskApi } from '@/lib/api/kiosk';
import { cn } from '@/lib/utils';
import { CaptureStage } from './CaptureStage';
import { COPY } from './copy';
import { CollectionDoneIllustration, KnownGroupIllustration, OutsiderGroupIllustration, PersonDoneIllustration, PreparationIllustration, ScreenAttackIllustration } from './illustrations';
import { playError, playSuccess } from './sounds';
import { WizardBrand } from './TotemWizard';
import { CARD_TITLE, EYEBROW, PRIMARY_BUTTON, QUIET_BUTTON, SECONDARY_BUTTON } from './ui';

/** Limites do envio: genuine 4–20 fotos (mínimo 2 pessoas), impostor 3–20, attack 1–20; total até 60. */
const LIMITS = { photosPerPerson: 3, minPeople: 2, maxPeople: 6, minImpostors: 3, maxImpostors: 20, minAttacks: 1, maxAttacks: 20 } as const;

export interface Shots {
  people: Blob[][];
  impostors: Blob[];
  attacks: Blob[];
}
const EMPTY: Shots = { people: [[]], impostors: [], attacks: [] };

type Phase = 'genuine' | 'impostor' | 'attack';
type Status = 'collecting' | 'sending' | 'failed' | 'done';

/** multipart do contrato: `sessionId`, `genuine` (p1_1.jpg, p1_2.jpg, p2_1.jpg…), `impostor`, `attack`. */
export function buildCalibrationForm(sessionId: string, shots: Shots): FormData {
  const form = new FormData();
  form.append('sessionId', sessionId);
  shots.people.forEach((person, p) => person.forEach((b, i) => form.append('genuine', b, `p${p + 1}_${i + 1}.jpg`)));
  shots.impostors.forEach((b, i) => form.append('impostor', b, `i_${i + 1}.jpg`));
  shots.attacks.forEach((b, i) => form.append('attack', b, `a_${i + 1}.jpg`));
  return form;
}

interface Action {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

/** Tela cheia com ilustração para tudo que interrompe a captura. Sem animação de saída: o totem não pode ficar preso. */
function FullScreenStep({ illustration, eyebrow, title, description, primary, secondary, onCancel }: {
  illustration: ReactNode;
  eyebrow: string;
  title: string;
  description: string;
  primary: Action;
  secondary?: Action;
  onCancel: () => void;
}) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-50 flex flex-col items-center overflow-y-auto bg-white px-6 py-8">
      <motion.div key={title} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', stiffness: 210, damping: 24 }} className="my-auto flex w-full max-w-lg flex-col items-center text-center">
        <div className="w-full max-w-[300px]">{illustration}</div>
        <p className={cn(EYEBROW, 'mt-6')}>{eyebrow}</p>
        <h2 className={CARD_TITLE}>{title}</h2>
        <p className="m-0 mt-3 text-[15px] leading-relaxed text-ink-2">{description}</p>
        <div className="mt-8 flex w-full flex-col gap-3">
          <button type="button" onClick={primary.onClick} disabled={primary.disabled} className={PRIMARY_BUTTON}>
            {primary.label} <CaretRight size={18} aria-hidden />
          </button>
          {secondary && (
            <button type="button" onClick={secondary.onClick} disabled={secondary.disabled} className={SECONDARY_BUTTON}>{secondary.label}</button>
          )}
          <button type="button" onClick={onCancel} className={QUIET_BUTTON}>{COPY.calibration.cancel}</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

const art = 'h-auto w-full';
const CARD_CENTER = 'flex flex-col items-center rounded-2xl border border-line bg-white px-6 py-8 text-center shadow-lg md:px-10';
const INTRO_ART = [PreparationIllustration, KnownGroupIllustration, OutsiderGroupIllustration, ScreenAttackIllustration];

export function CalibrationFlow({ api, sessionId, onSubmitted, onCancel, onKeyRejected }: {
  api: KioskApi;
  sessionId: string;
  /** Enviado (ou concluído): o app não volta a abrir esta sessão. */
  onSubmitted: () => void;
  /** "Agora não" ou cancelar: o app não volta a abrir esta sessão neste aparelho até recarregar. */
  onCancel: () => void;
  onKeyRejected: () => void;
}) {
  const c = COPY.calibration;
  const [shots, setShots] = useState<Shots>(EMPTY);
  const [phase, setPhase] = useState<Phase>('genuine');
  const [introStep, setIntroStep] = useState(0);
  const [started, setStarted] = useState(false);
  const [phaseIntro, setPhaseIntro] = useState<'impostor' | 'attack' | null>(null);
  /** Grupo 2 e teste da foto: pausa depois de cada foto para trocar de pessoa. */
  const [awaitingNext, setAwaitingNext] = useState(false);
  const [status, setStatus] = useState<Status>('collecting');
  /** Contagens para a tela final: as imagens já terão saído da memória. */
  const [sent, setSent] = useState({ people: 0, impostors: 0, attacks: 0 });

  const cancel = () => {
    setShots(EMPTY);
    onCancel();
  };

  const current = shots.people[shots.people.length - 1] ?? [];
  const completePeople = shots.people.filter((p) => p.length >= LIMITS.photosPerPerson).length;
  const impostors = shots.impostors.length;
  const attacks = shots.attacks.length;
  const canLeaveGroupOne = completePeople >= LIMITS.minPeople;
  const canLeaveGroupTwo = impostors >= LIMITS.minImpostors;
  const canFinish = attacks >= LIMITS.minAttacks;
  const personDone = phase === 'genuine' && current.length >= LIMITS.photosPerPerson;
  const paused = phaseIntro !== null || personDone || awaitingNext;
  const totalAll = shots.people.reduce((n, p) => n + p.length, 0) + impostors + attacks;

  const capture = (blob: Blob) => {
    if (phase === 'genuine') {
      setShots((s) => {
        const last = s.people[s.people.length - 1] ?? [];
        if (last.length >= LIMITS.photosPerPerson) return s;
        return { ...s, people: [...s.people.slice(0, -1), [...last, blob]] };
      });
      return;
    }
    if (phase === 'impostor') setShots((s) => (s.impostors.length >= LIMITS.maxImpostors ? s : { ...s, impostors: [...s.impostors, blob] }));
    else setShots((s) => (s.attacks.length >= LIMITS.maxAttacks ? s : { ...s, attacks: [...s.attacks, blob] }));
    setAwaitingNext(true);
  };

  const resume = () => {
    setPhaseIntro(null);
    setAwaitingNext(false);
  };

  const nextPerson = () => setShots((s) => (s.people.length >= LIMITS.maxPeople ? s : { ...s, people: [...s.people, []] }));

  const send = async () => {
    setStatus('sending');
    try {
      await api.submitCalibration(buildCalibrationForm(sessionId, shots));
      setSent({ people: shots.people.length, impostors, attacks });
      setShots(EMPTY);
      playSuccess();
      setStatus('done');
    } catch (e) {
      if (isKeyRejected(e)) {
        setShots(EMPTY);
        return onKeyRejected();
      }
      playError();
      setStatus('failed');
    }
  };

  const nextPhase = () => {
    setAwaitingNext(false);
    if (phase === 'genuine') {
      // Quem ficou com uma foto só não forma par de comparação: sai do envio.
      setShots((s) => ({ ...s, people: s.people.filter((p) => p.length >= 2) }));
      setPhase('impostor');
      setPhaseIntro('impostor');
    } else if (phase === 'impostor') {
      setPhase('attack');
      setPhaseIntro('attack');
    } else void send();
  };

  const instruction = phase === 'genuine' ? (COPY.poses[current.length % COPY.poses.length] ?? '') : phase === 'impostor' ? c.impostorInstruction : c.attackInstruction;
  const subtitle =
    phase === 'genuine'
      ? `Grupo 1 · pessoa ${shots.people.length} · foto ${Math.min(current.length + 1, LIMITS.photosPerPerson)} de ${LIMITS.photosPerPerson}`
      : phase === 'impostor'
        ? `Grupo 2 · ${impostors} de ${LIMITS.minImpostors} pessoas`
        : `Teste da foto · ${attacks} de ${LIMITS.minAttacks}`;
  const total = phase === 'genuine' ? LIMITS.photosPerPerson : phase === 'impostor' ? LIMITS.minImpostors : LIMITS.minAttacks;
  const completed = Math.min(phase === 'genuine' ? current.length : phase === 'impostor' ? impostors : attacks, total);

  // Saída de emergência quando uma pessoa não fecha as 3 fotos e é preciso seguir.
  const side =
    phase === 'genuine'
      ? { icon: Users, label: 'Concluir grupo 1', enabled: canLeaveGroupOne }
      : phase === 'impostor'
        ? { icon: DeviceMobile, label: 'Concluir grupo 2', enabled: canLeaveGroupTwo }
        : { icon: Check, label: 'Concluir coleta', enabled: canFinish };

  const overlay = (() => {
    if (status !== 'collecting') return null;
    if (phaseIntro === 'impostor') {
      return <FullScreenStep onCancel={cancel} illustration={<OutsiderGroupIllustration className={art} />} eyebrow="Etapa 2 de 3 · Grupo 2" title="Agora as pessoas de fora" description={`Chame ${LIMITS.minImpostors} pessoas que não estão no grupo 1. Cada uma passa uma vez pela câmera — uma foto por pessoa.`} primary={{ label: 'Chamar a primeira pessoa', onClick: resume }} />;
    }
    if (phaseIntro === 'attack') {
      return <FullScreenStep onCancel={cancel} illustration={<ScreenAttackIllustration className={art} />} eyebrow="Etapa 3 de 3 · Teste da foto" title="Hora do celular" description="Abra a foto de um rosto na tela do celular e segure o aparelho de frente para a câmera, na altura do rosto de uma pessoa." primary={{ label: 'Estou com o celular pronto', onClick: resume }} />;
    }
    if (personDone) {
      const atMax = shots.people.length >= LIMITS.maxPeople;
      return (
        <FullScreenStep
          onCancel={cancel}
          illustration={<PersonDoneIllustration className={art} />}
          eyebrow="Grupo 1"
          title={`Pessoa ${completePeople} cadastrada`}
          description={canLeaveGroupOne ? 'As 3 fotos foram aceitas. Pode seguir para o grupo 2 ou cadastrar mais uma pessoa aqui.' : `As 3 fotos foram aceitas. Chame a próxima pessoa do grupo 1 — são ${LIMITS.minPeople} no mínimo.`}
          primary={canLeaveGroupOne ? { label: 'Ir para o grupo 2', onClick: nextPhase } : { label: 'Chamar a próxima pessoa', onClick: nextPerson }}
          secondary={canLeaveGroupOne ? { label: atMax ? `Limite de ${LIMITS.maxPeople} pessoas` : 'Cadastrar mais uma pessoa', onClick: nextPerson, disabled: atMax } : undefined}
        />
      );
    }
    if (awaitingNext && phase === 'impostor') {
      const atMax = impostors >= LIMITS.maxImpostors;
      return (
        <FullScreenStep
          onCancel={cancel}
          illustration={<PersonDoneIllustration className={art} />}
          eyebrow="Grupo 2"
          title={`Pessoa ${impostors} registrada`}
          description={canLeaveGroupTwo ? 'Já dá para seguir para o teste da foto, ou registrar mais alguém do grupo 2.' : `Chame a próxima pessoa do grupo 2 — faltam ${LIMITS.minImpostors - impostors}.`}
          primary={canLeaveGroupTwo ? { label: 'Ir para o teste da foto', onClick: nextPhase } : { label: 'Chamar a próxima pessoa', onClick: resume }}
          secondary={canLeaveGroupTwo ? { label: atMax ? `Limite de ${LIMITS.maxImpostors} pessoas` : 'Registrar mais uma pessoa', onClick: resume, disabled: atMax } : undefined}
        />
      );
    }
    if (awaitingNext && phase === 'attack') {
      const atMax = attacks >= LIMITS.maxAttacks;
      return (
        <FullScreenStep
          onCancel={cancel}
          illustration={<ScreenAttackIllustration className={art} />}
          eyebrow="Teste da foto"
          title={`${attacks} ${attacks === 1 ? 'foto testada' : 'fotos testadas'}`}
          description="Repetir com outra foto ou outro ângulo deixa a proteção mais precisa — mas já dá para concluir."
          primary={{ label: 'Concluir a coleta', onClick: nextPhase, disabled: !canFinish }}
          secondary={{ label: atMax ? `Limite de ${LIMITS.maxAttacks} fotos` : 'Testar mais uma foto', onClick: resume, disabled: atMax }}
        />
      );
    }
    return null;
  })();

  const pages = c.intro(LIMITS.minPeople, LIMITS.minImpostors);
  const page = pages[introStep];
  const Illustration = INTRO_ART[introStep] ?? PreparationIllustration;
  const lastPage = introStep === pages.length - 1;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-40 flex flex-col items-center overflow-y-auto bg-white px-4 py-5 md:px-8">
      <div className="flex w-full max-w-2xl items-center justify-between gap-3">
        <WizardBrand />
        <div className="flex items-center gap-1">
          <span className="flex items-center gap-2 rounded-full border border-line bg-tint px-3.5 py-1.5 text-sm font-medium text-brand">
            <Pulse size={14} aria-hidden className="motion-safe:animate-pulse" />
            {c.mode}
          </span>
          {status !== 'done' && !started && (
            <button type="button" onClick={cancel} aria-label={c.later} className="cursor-pointer rounded-lg border-0 bg-transparent p-2.5 text-muted hover:bg-skeleton-soft hover:text-ink">
              <X size={20} aria-hidden />
            </button>
          )}
        </div>
      </div>

      <div className="flex w-full max-w-2xl flex-1 items-center py-5">
        <div className="w-full">
          {status === 'done' ? (
            <motion.div role="status" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', stiffness: 190, damping: 24 }} className={CARD_CENTER}>
              <CollectionDoneIllustration className="h-auto w-full max-w-[260px]" />
              <h2 className="m-0 mt-6 text-2xl font-semibold tracking-tight text-ink">{c.doneTitle}</h2>
              <p className="m-0 mt-2 max-w-sm text-[15px] leading-relaxed text-muted">{c.doneText(sent.people, sent.impostors, sent.attacks)}</p>
              <button type="button" onClick={onSubmitted} className={cn(PRIMARY_BUTTON, 'mt-6 max-w-sm')}>{c.doneButton}</button>
            </motion.div>
          ) : status === 'sending' || status === 'failed' ? (
            <div className={CARD_CENTER}>
              <CollectionDoneIllustration className="h-auto w-full max-w-[260px]" />
              <h2 className="m-0 mt-6 text-2xl font-semibold tracking-tight text-ink">{status === 'sending' ? c.sending : c.failedTitle}</h2>
              {status === 'failed' && (
                <div className="mt-4 flex w-full max-w-sm flex-col gap-3">
                  <p role="alert" className="m-0 rounded-lg border border-danger-line bg-danger-bg px-4 py-3 text-sm text-danger">{c.failedSend}</p>
                  <button type="button" onClick={() => void send()} className={PRIMARY_BUTTON}>{c.retry}</button>
                  <button type="button" onClick={cancel} className={QUIET_BUTTON}>{c.cancel}</button>
                </div>
              )}
            </div>
          ) : !started && page ? (
            <motion.div key={`intro-${introStep}`} initial={{ opacity: 0, x: 32 }} animate={{ opacity: 1, x: 0 }} transition={{ type: 'spring', stiffness: 210, damping: 24 }} className={CARD_CENTER}>
              <div className="w-full max-w-[340px]"><Illustration className={art} /></div>
              <p className={cn(EYEBROW, 'mt-6')}>{page.eyebrow}</p>
              <h2 className={CARD_TITLE}>{page.title}</h2>
              <p className="m-0 mt-3 max-w-md text-[15px] leading-relaxed text-ink-2">{page.description}</p>
              <div className="mt-7 flex w-full max-w-sm flex-col gap-3">
                <button type="button" onClick={() => (lastPage ? setStarted(true) : setIntroStep((s) => s + 1))} className={PRIMARY_BUTTON}>
                  {lastPage ? (
                    <><Camera size={20} aria-hidden />{c.start}</>
                  ) : (
                    <>{c.next} <ArrowRight size={18} aria-hidden /></>
                  )}
                </button>
                {introStep > 0 ? (
                  <button type="button" onClick={() => setIntroStep((s) => s - 1)} className={QUIET_BUTTON}><ArrowLeft size={16} aria-hidden /> {c.back}</button>
                ) : (
                  <button type="button" onClick={() => setStarted(true)} className={QUIET_BUTTON}>{c.skip}</button>
                )}
              </div>
              <div className="mt-6 flex items-center gap-2" aria-hidden>
                {pages.map((p, i) => (
                  <span key={p.eyebrow} className={cn('h-1.5 rounded-full transition-all', i === introStep ? 'w-6 bg-brand' : 'w-1.5 bg-line-strong')} />
                ))}
              </div>
            </motion.div>
          ) : null}
        </div>
      </div>

      {/* Palco fora de wrapper com key: o <video> não remonta a cada troca de etapa. */}
      {started && status === 'collecting' && (
        <CaptureStage
          icon={<Pulse size={20} aria-hidden />}
          title={c.mode}
          subtitle={subtitle}
          instruction={instruction}
          totalSteps={total}
          completedSteps={completed}
          acceptedTick={totalAll}
          paused={paused}
          anyFrame={phase === 'attack'}
          maxSide={960}
          quality={0.85}
          onCapture={capture}
          onClose={cancel}
          closeLabel={c.cancel}
          sideControls={
            <div className="flex flex-col items-center gap-1.5">
              <button
                type="button"
                onClick={nextPhase}
                disabled={!side.enabled}
                aria-label={side.label}
                className={cn('flex h-14 w-14 items-center justify-center rounded-full border backdrop-blur-xl transition-all', side.enabled ? 'cursor-pointer border-white/25 bg-white/10 text-white hover:bg-white/20' : 'cursor-not-allowed border-white/10 bg-white/5 text-white/30')}
              >
                <side.icon size={22} aria-hidden />
              </button>
              <span aria-hidden className="max-w-[76px] text-center text-[10px] leading-tight font-medium text-white/75">{side.label}</span>
            </div>
          }
        />
      )}

      {overlay}
    </motion.div>
  );
}
