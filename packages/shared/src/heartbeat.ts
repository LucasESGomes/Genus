/**
 * Sinal de vida para processos sem HTTP (rep-core, jobs), lido pelo healthcheck do contêiner.
 *
 * A cada `intervalMs` grava o instante atual em `file`, mas só enquanto `isHealthy()` for
 * verdadeiro (por exemplo, conexão com o Valkey pronta). O healthcheck do Compose compara a
 * idade do arquivo com um limite; se o processo travar ou perder a dependência, o arquivo
 * envelhece e o contêiner fica `unhealthy`. Sem `file` (fora do Docker), não faz nada.
 */
import { writeFileSync } from 'node:fs';
import { SystemClock, type Clock } from './clock.js';

export interface HeartbeatOptions {
  /** Caminho do arquivo (variável `HEARTBEAT_FILE`). Vazio desliga o sinal. */
  file: string | undefined;
  intervalMs?: number;
  isHealthy?: () => boolean;
  clock?: Clock;
}

/** Devolve a função que para o sinal. */
export function startHeartbeat(options: HeartbeatOptions): () => void {
  const { file, intervalMs = 5000, isHealthy = () => true, clock = new SystemClock() } = options;
  if (!file) return () => undefined;
  const beat = (): void => {
    if (!isHealthy()) return;
    try {
      writeFileSync(file, String(clock.now().getTime()));
    } catch {
      // Sem escrita, o healthcheck acusa; o processo não deve cair por isso.
    }
  };
  beat();
  const timer = setInterval(beat, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
