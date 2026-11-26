/** Nomes das filas e da imagem do Valkey (docs/SPEC-nsr-fila.md §6). */
export const PUNCHES_QUEUE = 'punches';
export const POST_PUNCH_QUEUE = 'post-punch';
/** Apuração automática: `recalculate-day` (rep-core e resgate) e o job agendado `close-days`; a api consome. */
export const DAY_RECALCULATION_QUEUE = 'day-recalculation';

/** Tag exata, nunca `latest`. Usada no compose e nos testes (Testcontainers). */
export const VALKEY_IMAGE = 'valkey/valkey:9.2.0-alpine';

/** Eventos do outbox publicados depois que o NSR é atribuído. A fila de cada um está em `routing.ts`. */
export const POST_PUNCH_EVENTS = ['generate-receipt-pdf', 'recalculate-day', 'official-qr'] as const;
export type PostPunchEvent = (typeof POST_PUNCH_EVENTS)[number];

/** Evento com consumidor e fila própria (`day-recalculation`). */
export const RECALCULATE_DAY_EVENT = 'recalculate-day' satisfies PostPunchEvent;

/** Job agendado de `day-recalculation`: encerra os dias que não geraram batida (falta, dia aberto). */
export const CLOSE_DAYS_JOB_NAME = 'close-days';

/**
 * Quanto o job concluído fica em `day-recalculation` (48 h). É a marca de processado para o
 * resgate: o outbox não muda (só o rep-core escreve no `arp`).
 */
export const DAY_RECALCULATION_KEEP_COMPLETED_SECONDS = 172_800;

/** Nome do job dentro da fila `punches`. */
export const PUNCH_JOB_NAME = 'punch';
