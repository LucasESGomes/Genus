'use client';
// Adaptado de visage/frontend/src/components/totem/EnrollmentWizard.tsx (fonte somente leitura)
//
// Cadastrar meu rosto: CPF + PIN (conferidos na hora) → confirmação → consentimento (LGPD art. 11) → 3 fotos → envio.
// CPF, PIN e fotos ficam só em memória (estado do componente); nunca em URL, storage ou log. Cancelar ou concluir apaga tudo.
import { ArrowLeft, Camera, Check, IdentificationCard, ShieldCheck, UserCheck, UserFocus, WarningCircle } from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api/errors';
import { isKeyRejected, type IdentityResult, type KioskApi } from '@/lib/api/kiosk';
import { CaptureStage } from './CaptureStage';
import { CONSENT_TEXT_VERSION, COPY } from './copy';
import { IdentifyStep } from './IdentifyStep';
import { maskCpf } from './Keypad';
import { playError, playSuccess } from './sounds';
import { WizardOutcome, WizardShell, type WizardStep } from './TotemWizard';
import { CARD, CARD_TITLE, EYEBROW, PRIMARY_BUTTON, SECONDARY_BUTTON } from './ui';

type Step = 'identify' | 'confirm' | 'consent' | 'ready' | 'capture' | 'network' | 'failed' | 'done' | 'refused';

const STEPS: WizardStep[] = [
  { key: 'identify', label: 'Identificação', icon: IdentificationCard },
  { key: 'confirm', label: 'Confirmação', icon: UserCheck },
  { key: 'consent', label: 'Consentimento', icon: ShieldCheck },
  { key: 'capture', label: 'Captura', icon: UserFocus },
];
const PHOTOS_NEEDED = 3;
const DONE_MS = 6000;
const REFUSED_MS = 5000;

/** Só o miolo do CPF aparece: a tela fica de frente para quem passa. */
const hideCpf = (cpf: string) => `***.${maskCpf(cpf).slice(4, 11)}-**`;

export function EnrollFlow({ api, onDone, onKeyRejected }: { api: KioskApi; onDone: () => void; onKeyRejected: () => void }) {
  const [step, setStep] = useState<Step>('identify');
  const [cpf, setCpf] = useState('');
  const [pin, setPin] = useState('');
  const [identity, setIdentity] = useState<IdentityResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [count, setCount] = useState(0);
  const photos = useRef<Blob[]>([]);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      photos.current = [];
    };
  }, []);

  const dropPhotos = () => {
    photos.current = [];
    setCount(0);
  };
  const wipe = useCallback(() => {
    photos.current = [];
    setCount(0);
    setCpf('');
    setPin('');
    setIdentity(null);
    setError(null);
  }, []);

  const exit = useCallback(() => {
    wipe();
    onDone();
  }, [wipe, onDone]);

  // Saída automática nas telas finais.
  useEffect(() => {
    if (step !== 'done' && step !== 'refused') return;
    const id = window.setTimeout(exit, step === 'done' ? DONE_MS : REFUSED_MS);
    return () => window.clearTimeout(id);
  }, [step, exit]);

  const refuse = (message: string) => {
    playError();
    setError(message);
    setAttempt((n) => n + 1);
  };

  const identify = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.verifyIdentity({ cpf, pin });
      if (!alive.current) return;
      setIdentity(result);
      setStep('confirm');
    } catch (e) {
      if (!alive.current) return;
      if (isKeyRejected(e)) {
        wipe();
        return onKeyRejected();
      }
      const err = e instanceof ApiError ? e : null;
      if (err?.code === 'CPF_OU_PIN_INVALIDO') refuse(COPY.enroll.invalid);
      else if (err?.status === 429) refuse(err.message);
      else refuse(err?.kind === 'network' ? COPY.setup.network : COPY.enroll.checkFailed);
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    const form = new FormData();
    form.append('cpf', cpf);
    form.append('pin', pin);
    form.append('consentAccepted', 'true');
    form.append('consentTextVersion', CONSENT_TEXT_VERSION);
    photos.current.forEach((p, i) => form.append('photos', p, `foto${i + 1}.jpg`));
    try {
      await api.enroll(form);
      if (!alive.current) return;
      dropPhotos();
      setCpf('');
      setPin('');
      playSuccess();
      setStep('done');
    } catch (e) {
      if (!alive.current) return;
      if (isKeyRejected(e)) {
        wipe();
        return onKeyRejected();
      }
      const err = e instanceof ApiError ? e : null;
      if (err?.kind === 'network') return setStep('network');
      dropPhotos();
      if (err?.code === 'CPF_OU_PIN_INVALIDO') {
        setIdentity(null);
        setStep('identify');
        return refuse(COPY.enroll.invalid);
      }
      playError();
      setError(err && (err.kind === 'validation' || err.kind === 'conflict' || err.status === 429) ? err.message : COPY.enroll.failed);
      setStep('failed');
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const addPhoto = (blob: Blob) => {
    if (photos.current.length >= PHOTOS_NEEDED) return;
    photos.current = [...photos.current, blob];
    setCount(photos.current.length);
    if (photos.current.length === PHOTOS_NEEDED) void submit();
  };

  const firstName = identity?.firstName ?? '';
  const pose = COPY.poses[Math.min(count, PHOTOS_NEEDED - 1)] ?? '';
  const full = count >= PHOTOS_NEEDED;
  const current = step === 'ready' || step === 'network' || step === 'failed' ? 'capture' : step;

  return (
    <WizardShell
      steps={STEPS}
      current={current}
      contentKey={step === 'capture' ? 'ready' : step}
      onExit={exit}
      exitLabel={COPY.enroll.cancel}
      stage={
        step === 'capture' && (
          <CaptureStage
            icon={<UserFocus size={20} aria-hidden />}
            title={firstName}
            subtitle={COPY.enroll.eyebrow}
            instruction={full ? COPY.enroll.sending : pose}
            totalSteps={PHOTOS_NEEDED}
            completedSteps={count}
            acceptedTick={count}
            sending={full}
            requireMotion
            onCapture={addPhoto}
            onClose={exit}
            closeLabel={COPY.enroll.cancel}
          />
        )
      }
    >
      {step === 'identify' && (
        <IdentifyStep
          cpf={cpf}
          pin={pin}
          onCpf={(v) => { setCpf(v); setError(null); }}
          onPin={(v) => { setPin(v); setError(null); }}
          error={error}
          attempt={attempt}
          busy={busy}
          onSubmit={() => void identify()}
        />
      )}

      {step === 'confirm' && identity && (
        <div className={CARD}>
          <p className={EYEBROW}>{COPY.enroll.confirmEyebrow}</p>
          <h2 className={CARD_TITLE}>{COPY.enroll.hello(firstName)}</h2>
          <p className="m-0 mt-2 text-[15px] text-muted">{COPY.enroll.confirmText}</p>
          <dl className="m-0 mt-6 divide-y divide-line rounded-xl border border-line">
            {[
              [COPY.enroll.nameLabel, firstName],
              [COPY.enroll.cpfLabel, hideCpf(cpf)],
              [COPY.enroll.statusLabel, identity.alreadyEnrolled ? COPY.enroll.enrolled : COPY.enroll.notEnrolled],
            ].map(([label, value]) => (
              <div key={label} className="flex flex-col gap-0.5 px-5 py-3.5">
                <dt className="text-xs font-medium text-muted">{label}</dt>
                <dd className="m-0 text-[15px] font-semibold text-ink">{value}</dd>
              </div>
            ))}
          </dl>
          {identity.alreadyEnrolled && <p className="m-0 mt-4 rounded-lg bg-warn-bg px-4 py-3 text-sm leading-relaxed text-warn">{COPY.enroll.replaceWarning}</p>}
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <button type="button" className={SECONDARY_BUTTON} onClick={() => { wipe(); setStep('identify'); }}>
              <ArrowLeft size={18} aria-hidden /> {COPY.enroll.notMe}
            </button>
            <button type="button" className={PRIMARY_BUTTON} onClick={() => setStep('consent')}>
              <Check size={18} aria-hidden /> {COPY.enroll.itsMe}
            </button>
          </div>
        </div>
      )}

      {step === 'consent' && (
        <div className={CARD}>
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-tint text-brand">
            <ShieldCheck size={24} aria-hidden />
          </span>
          <h2 className="m-0 mt-4 text-2xl font-semibold tracking-tight text-ink md:text-3xl">{COPY.enroll.consentTitle}</h2>
          <p className="m-0 mt-2 text-[15px] text-muted">{COPY.enroll.consentIntro}</p>
          <div tabIndex={0} role="region" aria-label="Termo de consentimento" className="mt-6 flex max-h-[32vh] flex-col gap-4 overflow-y-auto rounded-xl bg-surface p-5 text-sm leading-relaxed text-ink-2 select-text">
            {COPY.consent.map(([title, text]) => (
              <p key={title} className="m-0">
                <b className="font-semibold text-ink">{title}</b> {text}
              </p>
            ))}
          </div>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <button type="button" className={SECONDARY_BUTTON} onClick={() => { wipe(); setStep('refused'); }}>{COPY.enroll.consentRefuse}</button>
            <button type="button" className={PRIMARY_BUTTON} onClick={() => setStep('ready')}>
              <ShieldCheck size={18} aria-hidden /> {COPY.enroll.consentAgree}
            </button>
          </div>
        </div>
      )}

      {(step === 'ready' || step === 'capture') && (
        <div className="flex min-h-[min(62vh,640px)] flex-col items-center justify-center gap-6 rounded-2xl bg-brand-active p-8 text-center shadow-lg">
          <span className="flex h-24 w-24 items-center justify-center rounded-full bg-white/10 text-accent">
            <UserFocus size={44} aria-hidden />
          </span>
          <div>
            <h2 className="m-0 text-xl font-semibold text-white md:text-2xl">{COPY.enroll.readyTitle(firstName)}</h2>
            <p className="mx-auto mt-2 mb-0 max-w-sm text-[15px] leading-relaxed text-white/70">{COPY.enroll.readyText(PHOTOS_NEEDED)}</p>
          </div>
          <button type="button" onClick={() => setStep('capture')} className="flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border-0 bg-accent px-8 text-base font-semibold text-on-accent shadow-md hover:brightness-95">
            <Camera size={20} aria-hidden />
            {COPY.enroll.startCamera}
          </button>
        </div>
      )}

      {(step === 'network' || step === 'failed') && (
        <div role="alert" className="flex flex-col items-center gap-4 rounded-2xl border border-line bg-white px-6 py-12 text-center shadow-lg">
          <span className="flex h-20 w-20 items-center justify-center rounded-full bg-warn-bg text-warn"><WarningCircle size={40} aria-hidden /></span>
          <h2 className="m-0 max-w-md text-2xl font-semibold tracking-tight text-balance text-ink">{step === 'network' ? COPY.enroll.network : error}</h2>
          <div className="flex w-full max-w-sm flex-col gap-3">
            {step === 'network' ? (
              <button type="button" className={PRIMARY_BUTTON} disabled={busy} onClick={() => void submit()}>{busy ? COPY.enroll.sending : COPY.enroll.retry}</button>
            ) : (
              <button type="button" className={PRIMARY_BUTTON} onClick={() => { setError(null); setStep('ready'); }}>{COPY.enroll.redo}</button>
            )}
          </div>
        </div>
      )}

      {step === 'done' && (
        <WizardOutcome title={COPY.enroll.doneTitle} message={COPY.enroll.doneText(firstName)}>
          <button type="button" className={PRIMARY_BUTTON} onClick={exit}>{COPY.enroll.doneButton}</button>
        </WizardOutcome>
      )}

      {step === 'refused' && (
        <WizardOutcome icon={<ShieldCheck size={36} aria-hidden />} title={COPY.enroll.refusedTitle} message={COPY.enroll.refusedText}>
          <button type="button" className={PRIMARY_BUTTON} onClick={exit}>{COPY.enroll.doneButton}</button>
        </WizardOutcome>
      )}
    </WizardShell>
  );
}
