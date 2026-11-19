/**
 * Semáforo FIFO com prazo na espera. `acquire` devolve `false` se o prazo
 * estourar antes de abrir vaga (o chamador vira fallback; a fila não trava).
 */
export class Semaphore {
  private active = 0;
  private readonly waiters: Array<{ grant: () => void }> = [];

  constructor(private readonly max: number) {
    if (!Number.isInteger(max) || max < 1) throw new Error('maxConcurrency deve ser inteiro >= 1');
  }

  acquire(timeoutMs: number): Promise<boolean> {
    if (this.active < this.max) {
      this.active++;
      return Promise.resolve(true);
    }
    if (timeoutMs <= 0) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      const waiter = {
        grant: () => {
          clearTimeout(timer);
          resolve(true);
        },
      };
      const timer = setTimeout(() => {
        const i = this.waiters.indexOf(waiter);
        if (i >= 0) this.waiters.splice(i, 1);
        resolve(false);
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  /** Libera a vaga: passa direto ao próximo da fila (a contagem de ativos não muda). */
  release(): void {
    const next = this.waiters.shift();
    if (next) next.grant();
    else this.active--;
  }

  get inFlight(): number {
    return this.active;
  }

  get queued(): number {
    return this.waiters.length;
  }
}
