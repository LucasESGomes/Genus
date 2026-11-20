/** Nomes das filas e da imagem do Valkey (docs/SPEC-nsr-fila.md §6). */
export const PUNCHES_QUEUE = 'punches';
export const POST_PUNCH_QUEUE = 'post-punch';

/** Tag exata, nunca `latest`. Usada no compose e nos testes (Testcontainers). */
export const VALKEY_IMAGE = 'valkey/valkey:9.2.0-alpine';

/** Eventos do outbox publicados em `post-punch` depois que o NSR é atribuído. */
export const POST_PUNCH_EVENTS = ['generate-receipt-pdf', 'recalculate-day', 'official-qr'] as const;
export type PostPunchEvent = (typeof POST_PUNCH_EVENTS)[number];

/** Nome do job dentro da fila `punches`. */
export const PUNCH_JOB_NAME = 'punch';
