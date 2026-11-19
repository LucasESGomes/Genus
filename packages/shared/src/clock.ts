/**
 * Relógio injetável. Services nunca chamam `new Date()`/`Date.now()`: recebem
 * um Clock, para testar virada de dia e divergência de hora.
 */
export interface Clock {
  now(): Date;
}

/** Relógio real. Único lugar autorizado a ler a hora do sistema. */
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/** Relógio controlável para testes. */
export class FixedClock implements Clock {
  private current: Date;

  constructor(initial: Date | string) {
    this.current = new Date(initial);
  }

  now(): Date {
    return new Date(this.current.getTime());
  }

  set(instant: Date | string): void {
    this.current = new Date(instant);
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

/** Cronômetro monotônico para medir etapas (não é hora de calendário). */
export function startTimer(): () => number {
  const start = process.hrtime.bigint();
  return () => Number(process.hrtime.bigint() - start) / 1e6;
}

/** Arredonda ms para 2 casas (logs e Server-Timing). */
export function roundMs(ms: number): number {
  return Math.round(ms * 100) / 100;
}
