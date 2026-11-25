'use client';
// Adaptado de visage/frontend/src/components/totem/EnrollmentWizard.tsx (fonte somente leitura)
//
// Cadastrar meu rosto: CPF → PIN → consentimento (LGPD art. 11) → 3 fotos guiadas → envio.
// CPF, PIN e fotos ficam só em memória (estado do componente); nunca em URL, storage ou log. Cancelar ou concluir apaga tudo.
import { CheckCircle, WarningCircle } from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ApiError } from '@/lib/api/errors';
import { isKeyRejected, type KioskApi } from '@/lib/api/kiosk';
import { CaptureCamera } from './CaptureCamera';
import { CONSENT_TEXT_VERSION, COPY } from './copy';
import { BIG_BUTTON, KioskFrame } from './KioskFrame';
import { Keypad, maskCpf, onlyDigits } from './Keypad';

type Step = 'cpf' | 'pin' | 'consent' | 'photos' | 'sending' | 'network' | 'failed' | 'done';
const FLOW_STEPS: Step[] = ['cpf', 'pin', 'consent', 'photos'];
const PHOTOS_NEEDED = 3;

interface Photo {
  blob: Blob;
  url: string | null;
}

function objectUrl(blob: Blob): string | null {
  try {
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

const revoke = (photos: Photo[]) => photos.forEach((p) => p.url && URL.revokeObjectURL(p.url));

export function EnrollFlow({ api, onDone, onKeyRejected }: { api: KioskApi; onDone: () => void; onKeyRejected: () => void }) {
  const [step, setStep] = useState<Step>('cpf');
  const [cpf, setCpf] = useState('');
  const [pin, setPin] = useState('');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const photosRef = useRef<Photo[]>([]);
  photosRef.current = photos;

  // Sair da tela por qualquer caminho solta as miniaturas.
  useEffect(() => () => revoke(photosRef.current), []);

  const wipe = useCallback(() => {
    revoke(photosRef.current);
    setPhotos([]);
    setCpf('');
    setPin('');
  }, []);

  const cancel = useCallback(() => {
    wipe();
    onDone();
  }, [wipe, onDone]);

  const submit = useCallback(
    async (list: Photo[]) => {
      setStep('sending');
      const form = new FormData();
      form.append('cpf', cpf);
      form.append('pin', pin);
      form.append('consentAccepted', 'true');
      form.append('consentTextVersion', CONSENT_TEXT_VERSION);
      list.forEach((p, i) => form.append('photos', p.blob, `foto${i + 1}.jpg`));
      try {
        await api.enroll(form);
        wipe();
        setStep('done');
      } catch (e) {
        if (isKeyRejected(e)) {
          wipe();
          return onKeyRejected();
        }
        if (e instanceof ApiError && e.kind === 'network') return setStep('network');
        // Falha genérica (CPF/PIN ou outra): não revela qual. Apaga tudo e recomeça.
        wipe();
        setStep('failed');
      }
    },
    [api, cpf, pin, wipe, onKeyRejected],
  );

  const addPhoto = useCallback(
    (blob: Blob) => {
      const next = [...photosRef.current, { blob, url: objectUrl(blob) }];
      setPhotos(next);
      if (next.length >= PHOTOS_NEEDED) void submit(next);
    },
    [submit],
  );

  const redoLast = () => {
    const last = photosRef.current.at(-1);
    if (last?.url) URL.revokeObjectURL(last.url);
    setPhotos(photosRef.current.slice(0, -1));
  };

  const cancelButton = <Button variant="ghost" className="h-12 text-base" onClick={cancel}>{COPY.enroll.cancel}</Button>;
  const index = FLOW_STEPS.indexOf(step);

  if (step === 'done') {
    return (
      <KioskFrame>
        <div role="status" className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <div className="flex h-24 w-24 items-center justify-center rounded-full bg-good-bg"><CheckCircle size={64} weight="fill" className="text-good" aria-hidden /></div>
          <h1 className="m-0 text-3xl font-bold">{COPY.enroll.doneTitle}</h1>
          <p className="m-0 text-xl text-pretty">{COPY.enroll.doneText}</p>
          <Button variant="primary" className={BIG_BUTTON} onClick={onDone}>{COPY.enroll.doneButton}</Button>
        </div>
      </KioskFrame>
    );
  }

  if (step === 'sending') {
    return (
      <KioskFrame>
        <div role="status" aria-busy="true" className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <h1 className="m-0 text-2xl font-bold">{COPY.enroll.sending}</h1>
        </div>
      </KioskFrame>
    );
  }

  if (step === 'network' || step === 'failed') {
    const isNetwork = step === 'network';
    return (
      <KioskFrame action={cancelButton}>
        <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-warn-bg"><WarningCircle size={44} className="text-warn" aria-hidden /></div>
          <h1 className="m-0 text-2xl font-bold text-pretty">{isNetwork ? COPY.enroll.network : COPY.enroll.failed}</h1>
          {isNetwork ? (
            <Button variant="primary" className={BIG_BUTTON} onClick={() => void submit(photosRef.current)}>{COPY.enroll.retry}</Button>
          ) : (
            <Button variant="primary" className={BIG_BUTTON} onClick={() => setStep('cpf')}>{COPY.enroll.restart}</Button>
          )}
        </div>
      </KioskFrame>
    );
  }

  const dots = (
    <ol aria-label={`Passo ${index + 1} de ${FLOW_STEPS.length}`} className="m-0 flex list-none justify-center gap-2 p-0">
      {FLOW_STEPS.map((s, i) => (
        <li key={s} aria-hidden className={`h-2.5 w-8 rounded-full ${i <= index ? 'bg-brand' : 'bg-line-strong'}`} />
      ))}
    </ol>
  );

  return (
    <KioskFrame action={cancelButton}>
      {dots}
      {step === 'cpf' && (
        <>
          <h1 className="m-0 text-center text-2xl font-bold">{COPY.enroll.cpfTitle}</h1>
          <input
            aria-label={COPY.enroll.cpfLabel}
            inputMode="none"
            autoComplete="off"
            value={maskCpf(cpf)}
            onChange={(e) => setCpf(onlyDigits(e.target.value).slice(0, 11))}
            placeholder="000.000.000-00"
            className="h-16 w-full rounded-lg border border-line-strong bg-white px-4 text-center text-2xl font-bold tabular-nums"
          />
          <Keypad onDigit={(d) => setCpf((v) => (v.length < 11 ? v + d : v))} onBackspace={() => setCpf((v) => v.slice(0, -1))} />
          <Button variant="primary" className={BIG_BUTTON} disabled={cpf.length !== 11} onClick={() => setStep('pin')}>{COPY.enroll.next}</Button>
        </>
      )}
      {step === 'pin' && (
        <>
          <h1 className="m-0 text-center text-2xl font-bold">{COPY.enroll.pinTitle}</h1>
          <p className="m-0 text-center text-base text-muted">{COPY.enroll.pinText}</p>
          <input
            aria-label={COPY.enroll.pinLabel}
            type="password"
            inputMode="none"
            autoComplete="off"
            value={pin}
            onChange={(e) => setPin(onlyDigits(e.target.value).slice(0, 6))}
            className="h-16 w-full rounded-lg border border-line-strong bg-white px-4 text-center text-2xl font-bold tracking-[0.4em]"
          />
          <Keypad onDigit={(d) => setPin((v) => (v.length < 6 ? v + d : v))} onBackspace={() => setPin((v) => v.slice(0, -1))} />
          <Button variant="primary" className={BIG_BUTTON} disabled={pin.length < 4} onClick={() => setStep('consent')}>{COPY.enroll.next}</Button>
          <Button variant="secondary" className={BIG_BUTTON} onClick={() => setStep('cpf')}>{COPY.enroll.back}</Button>
        </>
      )}
      {step === 'consent' && (
        <>
          <h1 className="m-0 text-center text-2xl font-bold">{COPY.enroll.consentTitle}</h1>
          <div className="flex flex-col gap-3 rounded-card border border-line bg-white p-4 text-base">
            {COPY.consent.map((p) => (
              <p key={p} className="m-0 text-pretty">{p}</p>
            ))}
          </div>
          <Button variant="primary" className={BIG_BUTTON} onClick={() => setStep('photos')}>{COPY.enroll.consentAgree}</Button>
          <Button variant="secondary" className={BIG_BUTTON} onClick={() => setStep('pin')}>{COPY.enroll.back}</Button>
        </>
      )}
      {step === 'photos' && <PhotosStep photos={photos} onCapture={addPhoto} onRedo={redoLast} />}
    </KioskFrame>
  );
}

function PhotosStep({ photos, onCapture, onRedo }: { photos: Photo[]; onCapture: (b: Blob) => void; onRedo: () => void }) {
  const pose = COPY.poses[Math.min(photos.length, PHOTOS_NEEDED - 1)] ?? COPY.poses[0];
  return (
    <>
      <div className="flex flex-col gap-1 text-center">
        <h1 className="m-0 text-2xl font-bold">{`Foto ${photos.length + 1} de ${PHOTOS_NEEDED}: ${pose.title}`}</h1>
        <p className="m-0 text-base text-muted">{pose.text}</p>
      </div>
      <CaptureCamera onCapture={onCapture} />
      <div role="group" className="flex items-center justify-center gap-3" aria-label="Fotos tiradas">
        {Array.from({ length: PHOTOS_NEEDED }, (_, i) => {
          const p = photos[i];
          return p?.url ? (
            <img key={i} src={p.url} alt={`Foto ${i + 1}`} className="h-16 w-12 -scale-x-100 rounded-md border border-line object-cover" />
          ) : (
            <div key={i} aria-hidden className="h-16 w-12 rounded-md border border-dashed border-line-strong bg-white" />
          );
        })}
      </div>
      {photos.length > 0 && <Button variant="ghost" className="h-12 text-base" onClick={onRedo}>{COPY.enroll.redo}</Button>}
    </>
  );
}
