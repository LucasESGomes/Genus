/** O banco ou uma transação aberta: repositórios aceitam os dois. */
import type { Database } from './client';

export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type Executor = Database | Transaction;
