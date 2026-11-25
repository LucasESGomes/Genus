/**
 * Borda dos IDs. Fora deste arquivo, todo ID é `EntityId` (string opaca): a tela nunca soma,
 * compara por ordem nem itera IDs. Hoje a api devolve BIGINT sequencial; quando passar a
 * `publicId` (UUID), só muda aqui (ver docs/portal-arquitetura-front.md §IDOR).
 */
import type { EntityId } from './contracts';
import { ApiError, HIDDEN_RESOURCE_MESSAGE } from './errors';

const NUMERIC = /^[1-9][0-9]{0,15}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isEntityId = (v: unknown): v is EntityId => typeof v === 'string' && (NUMERIC.test(v) || UUID.test(v));

/** ID vindo da rota (`params.id`). Inválido → null: a tela mostra "não encontrado" sem chamar a api. */
export function parseRouteId(v: string | string[] | undefined): EntityId | null {
  const s = Array.isArray(v) ? v[0] : v;
  return isEntityId(s) ? s : null;
}

/** Mesmo erro do 404: ID inválido nunca chega ao fetch e a tela não diferencia. */
export const invalidIdError = () => new ApiError('not_found', 404, 'ID_INVALIDO', HIDDEN_RESOURCE_MESSAGE);

/** Monta o caminho da api com IDs validados e codificados. Lança (ApiError not_found) antes do fetch se algum ID for inválido. */
export function apiPath(strings: TemplateStringsArray, ...ids: EntityId[]): string {
  return strings.reduce((acc, part, i) => {
    if (i === 0) return part;
    const id = ids[i - 1];
    if (!isEntityId(id)) throw invalidIdError();
    return acc + encodeURIComponent(id) + part;
  }, '');
}

const isIdKey = (k: string) => k === 'id' || k.endsWith('Id') || k === 'establishmentScope' || k.endsWith('Ids');

/** Converte para string todo número em chave de ID (`id`, `*Id`, `*Ids`, `establishmentScope`), em qualquer profundidade. */
export function normalizeIds<T>(value: unknown): T {
  const walk = (v: unknown, idKey: boolean): unknown => {
    if (Array.isArray(v)) return v.map((x) => walk(x, idKey));
    if (v !== null && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) out[k] = walk(x, isIdKey(k));
      return out;
    }
    if (idKey && typeof v === 'number') return String(v);
    return v;
  };
  return walk(value, false) as T;
}
