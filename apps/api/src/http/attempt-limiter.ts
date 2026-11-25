/**
 * Limite simples de tentativas erradas por chave (IP, conta...), em memória do processo.
 * [A CONFIRMAR] com várias instâncias da api o limite vale por instância; mover para o Valkey
 * se a api passar a rodar replicada.
 */
import type { Clock } from '@genus/shared';
import { HttpError } from '../plugins/error-handler';

export class AttemptLimiter {
  private readonly failures = new Map<string, number[]>();

  constructor(
    private readonly clock: Clock,
    private readonly max = 5,
    private readonly windowMs = 15 * 60_000,
  ) {}

  private recent(key: string): number[] {
    const now = this.clock.now().getTime();
    const list = (this.failures.get(key) ?? []).filter((t) => now - t < this.windowMs);
    this.failures.set(key, list);
    return list;
  }

  /** Esvazia as chaves vencidas para o mapa não crescer sem limite (chamado a cada falha). */
  private sweep(): void {
    if (this.failures.size < 5_000) return;
    const now = this.clock.now().getTime();
    for (const [key, list] of this.failures) {
      if (list.every((t) => now - t >= this.windowMs)) this.failures.delete(key);
    }
  }

  assertAllowed(key: string): void {
    if (this.recent(key).length >= this.max) throw new HttpError(429, 'MUITAS_TENTATIVAS', 'Muitas tentativas. Aguarde alguns minutos');
  }

  fail(key: string): void {
    this.sweep();
    this.recent(key).push(this.clock.now().getTime());
  }

  reset(key: string): void {
    this.failures.delete(key);
  }
}
