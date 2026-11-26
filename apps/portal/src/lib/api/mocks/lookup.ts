/** Mock das consultas públicas: lista curta de municípios e uma razão social fictícia. */
import type { LookupApi } from '../endpoints/lookup';
import { delay } from './runtime';

const MUNICIPALITIES: Record<string, [string, string][]> = {
  GO: [['5201108', 'Anápolis'], ['5208707', 'Goiânia'], ['5218805', 'Rio Verde']],
  MS: [['5002704', 'Campo Grande'], ['5003702', 'Dourados'], ['5008305', 'Três Lagoas']],
  SP: [['3509502', 'Campinas'], ['3550308', 'São Paulo']],
};

export const mockLookupApi: LookupApi = {
  municipalities: async (uf) => {
    await delay();
    return (MUNICIPALITIES[uf] ?? []).map(([id, name]) => ({ id, name }));
  },
  company: async () => {
    await delay();
    return { legalName: 'Empresa Fictícia Ltda' };
  },
};
