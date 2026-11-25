'use client';
import { Camera, DeviceMobile, UserCirclePlus, WifiSlash } from '@phosphor-icons/react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import type { KioskContext } from '@/lib/api/kiosk';
import { COPY } from './copy';
import { DeviceSheet } from './DeviceSheet';
import { KioskClock } from './KioskClock';
import { BIG_BUTTON, KioskFrame } from './KioskFrame';

export function KioskHome({ context, offline, keyPrefix, onRetry, onPunch, onEnroll, onDisconnect }: {
  context: KioskContext | undefined;
  offline: boolean;
  keyPrefix: string;
  onRetry: () => void;
  onPunch: () => void;
  onEnroll: () => void;
  onDisconnect: () => void;
}) {
  const [sheet, setSheet] = useState(false);
  return (
    <KioskFrame
      action={
        <Button variant="ghost" className="h-12 text-base" icon={<DeviceMobile size={22} aria-hidden />} onClick={() => setSheet(true)}>{COPY.home.device}</Button>
      }
    >
      {offline && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warn bg-warn-bg px-4 py-3 text-warn">
          <span className="flex items-center gap-2 text-base font-semibold"><WifiSlash size={22} aria-hidden />{COPY.home.offline}. {COPY.home.offlineText}</span>
          <Button variant="secondary" className="h-12" onClick={onRetry}>{COPY.home.retry}</Button>
        </div>
      )}
      <div className="flex flex-1 flex-col items-center justify-center gap-8 py-6">
        <div className="flex flex-col items-center gap-1 text-center">
          <h1 className="m-0 text-xl font-bold">{context?.establishment.name ?? 'Registro de ponto'}</h1>
          {context && <p className="m-0 text-base text-muted">{context.device.name}</p>}
        </div>
        <KioskClock />
        <div className="flex w-full flex-col gap-3">
          <Button variant="accent" className="h-20 w-full text-2xl" icon={<Camera size={32} aria-hidden />} onClick={onPunch}>{COPY.home.punch}</Button>
          <Button variant="secondary" className={BIG_BUTTON} icon={<UserCirclePlus size={24} aria-hidden />} onClick={onEnroll}>{COPY.home.enroll}</Button>
        </div>
      </div>
      <DeviceSheet open={sheet} onOpenChange={setSheet} context={context} prefix={keyPrefix} onDisconnect={() => { setSheet(false); onDisconnect(); }} />
    </KioskFrame>
  );
}
