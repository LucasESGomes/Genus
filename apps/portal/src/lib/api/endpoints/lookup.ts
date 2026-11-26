/**
 * Consultas a bases públicas, direto do navegador (as duas liberam CORS; sem chave):
 * municípios da UF no IBGE e razão social do CNPJ na BrasilAPI. Só sai a UF ou o CNPJ da empresa,
 * sem cookie e sem referrer. São ajuda de preenchimento: se falharem, a tela deixa digitar.
 */
export interface Municipality {
  /** Código IBGE de 7 dígitos. */
  id: string;
  name: string;
}

export interface CompanyRegistry {
  legalName: string;
}

const IBGE = 'https://servicodados.ibge.gov.br/api/v1/localidades/estados';
const BRASIL_API = 'https://brasilapi.com.br/api/cnpj/v1';

export const lookupApi = (fetcher: typeof fetch = (...a) => fetch(...a)) => {
  const get = (url: string, signal?: AbortSignal) => fetcher(url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
  return {
    municipalities: async (uf: string, signal?: AbortSignal): Promise<Municipality[]> => {
      const res = await get(`${IBGE}/${encodeURIComponent(uf)}/municipios?orderBy=nome`, signal);
      if (!res.ok) throw new Error(`IBGE ${res.status}`);
      const list = (await res.json()) as { id: number; nome: string }[];
      return list.map((m) => ({ id: String(m.id), name: m.nome }));
    },
    /** `cnpj` com 14 dígitos. null = a base não conhece o CNPJ. */
    company: async (cnpj: string, signal?: AbortSignal): Promise<CompanyRegistry | null> => {
      const res = await get(`${BRASIL_API}/${encodeURIComponent(cnpj)}`, signal);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`BrasilAPI ${res.status}`);
      const body = (await res.json()) as { razao_social?: unknown };
      const legalName = typeof body.razao_social === 'string' ? body.razao_social.trim() : '';
      return legalName ? { legalName } : null;
    },
  };
};
export type LookupApi = ReturnType<typeof lookupApi>;
