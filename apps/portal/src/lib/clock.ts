/**
 * Relógio injetável. É o ÚNICO lugar do portal com `new Date()` sem argumento (o lint só libera
 * arquivos `clock.ts`). Telas pegam a hora por `useClock()` (lib/clock-context.tsx).
 */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/** Relógio parado (testes e capturas). */
export const fixedClock = (iso: string): Clock => ({ now: () => new Date(iso) });
