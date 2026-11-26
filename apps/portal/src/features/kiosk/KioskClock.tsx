'use client';
// Adaptado de visage/frontend/src/components/totem/TotemClock.tsx (fonte somente leitura)
import { useEffect, useState } from 'react';
import { DEFAULT_TZ } from '@/lib/format';
import { useClock } from '@/lib/clock-context';

function parts(now: Date, tz: string) {
  const time = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: tz }).formatToParts(now);
  const get = (type: string) => time.find((p) => p.type === type)?.value ?? '00';
  const date = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz }).format(now);
  return { hh: get('hour'), mm: get('minute'), ss: get('second'), date };
}

/** Relógio gigante do totem. Hora só por `useClock()`; o intervalo de 1 s apenas relê o relógio. */
export function KioskClock({ tz = DEFAULT_TZ }: { tz?: string }) {
  const clock = useClock();
  // Começa vazio: o servidor e o navegador não precisam concordar no segundo (evita erro de hidratação).
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(clock.now());
    const id = window.setInterval(() => setNow(clock.now()), 1000);
    return () => window.clearInterval(id);
  }, [clock]);

  if (!now) return <div className="h-36" aria-hidden />;
  const { hh, mm, ss, date } = parts(now, tz);
  return (
    <div className="text-center">
      <p
        data-testid="kiosk-clock"
        aria-label={`${hh} horas e ${mm} minutos`}
        className="m-0 font-mono text-[clamp(4rem,16vw,9rem)] leading-none font-semibold tracking-tight text-ink tabular-nums"
      >
        {hh}:{mm}
        <span aria-hidden className="text-line-hover">:{ss}</span>
      </p>
      {/* Só a primeira letra: "Quarta-feira, 25 de novembro" (capitalize poria "De Novembro"). */}
      <p className="m-0 mt-4 text-base text-muted first-letter:uppercase md:text-lg">{date}</p>
    </div>
  );
}
