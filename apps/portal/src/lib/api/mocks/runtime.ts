/**
 * Utilitários dos mocks (NEXT_PUBLIC_USE_MOCKS=true). Os mocks imitam o contrato e os erros da api:
 * mesma forma de `{ data, meta }`, mesmos códigos de erro, 404 fora do escopo. Dados fictícios.
 */
import type { ListMeta, PaginationQuery } from '../contracts';
import { toApiError, unavailableError } from '../errors';

export const useMocks = () => process.env.NEXT_PUBLIC_USE_MOCKS === 'true';

/** Latência simulada; em teste (NODE_ENV=test) responde na hora. */
export const delay = (ms = 250) => (process.env.NODE_ENV === 'test' ? Promise.resolve() : new Promise<void>((r) => setTimeout(r, ms)));

export function paginate<T>(items: readonly T[], q: PaginationQuery = {}): { data: T[]; meta: ListMeta } {
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 25;
  return { data: items.slice((page - 1) * pageSize, page * pageSize), meta: { page, pageSize, total: items.length } };
}

/** Minúsculas e sem acento: a busca por texto do mock imita o ILIKE com unaccent da api. */
export const foldText = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** `q` aparece em algum dos campos (sem acento, sem caixa). `q` vazio casa tudo. */
export const matchesQuery = (q: string | undefined, ...fields: (string | null | undefined)[]) => {
  const needle = foldText((q ?? '').trim());
  return needle === '' || fields.some((f) => foldText(f ?? '').includes(needle));
};

/** Erro no formato da api (`{ error, code, details }`), passando pelo mesmo tradutor do cliente. */
export const mockFail = (status: number, code: string, error: string, details?: { path: string; message: string }[]) =>
  toApiError(status, { error, code, details });

export const mockNotFound = () => mockFail(404, 'NOT_FOUND', 'Recurso não encontrado');

let seq = 9000;
/** ID novo para itens criados no mock (string opaca, como na borda real). */
export const mockId = () => String(++seq);

/** Clona para a tela não alterar o "banco" do mock por referência. */
export const clone = <T>(v: T): T => structuredClone(v);

/** Módulo ainda sem mock: toda chamada responde "Em breve". O lote dono troca por dados reais de mock. */
export function notMocked<T extends object>(): T {
  return new Proxy({} as T, {
    get: () => async () => {
      await delay(0);
      throw unavailableError();
    },
  });
}
