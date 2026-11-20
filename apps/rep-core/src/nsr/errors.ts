/**
 * Erros da transação do NSR (docs/SPEC-nsr-fila.md §5). `recoverable` diz ao worker
 * se vale tentar de novo: erro de conexão, deadlock e falha de INSERT são
 * recuperáveis (não carregam a propriedade e `isRecoverable` os trata assim).
 */
export abstract class AssignNsrError extends Error {
  abstract readonly recoverable: boolean;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Entrada inexistente para o tenant. Também cobre entrada de outra conta (isolamento). */
export class EntryNotFoundError extends AssignNsrError {
  readonly recoverable = false;
  constructor(
    readonly tenantId: number,
    readonly entryId: number,
  ) {
    super(`Entrada ${entryId} não encontrada para a conta ${tenantId}.`);
  }
}

/** Entrada já marcada `falhou`: não reprocessar, só avisar. */
export class EntryFailedError extends AssignNsrError {
  readonly recoverable = false;
  constructor(readonly entryId: number) {
    super(`Entrada ${entryId} está marcada como falhou e não será reprocessada.`);
  }
}

/** Entrada `processado` sem registro, evidência ou os 3 eventos do outbox: inconsistência. */
export class OutboxIncompleteError extends AssignNsrError {
  readonly recoverable = false;
  constructor(
    readonly entryId: number,
    detail: string,
  ) {
    super(`Entrada ${entryId} processada, mas incompleta: ${detail}.`);
  }
}

/** A sequência do estabelecimento pertence a outra conta: quebra de isolamento de tenant. */
export class SequenceTenantMismatchError extends AssignNsrError {
  readonly recoverable = false;
  constructor(readonly establishmentId: number) {
    super(`A sequência do estabelecimento ${establishmentId} pertence a outra conta.`);
  }
}

/** Já existe evidência com o mesmo (aparelho, sequência) para OUTRA entrada. */
export class DuplicateDeviceSequenceError extends AssignNsrError {
  readonly recoverable = false;
  constructor(
    readonly entryId: number,
    readonly otherEntryId: number,
  ) {
    super(`Entrada ${entryId} repete (aparelho, sequência) da entrada ${otherEntryId}.`);
  }
}

/** false só para os erros de domínio acima; o resto (conexão, deadlock, INSERT) tenta de novo. */
export function isRecoverable(err: unknown): boolean {
  if (err instanceof AssignNsrError) return err.recoverable;
  return true;
}
