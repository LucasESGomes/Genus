import { unavailableError } from './errors';

/** Endpoint que o back ainda não tem. Com mocks desligados, a tela recebe `unavailable` e mostra "Em breve". */
export const missing = async (): Promise<never> => {
  throw unavailableError();
};
