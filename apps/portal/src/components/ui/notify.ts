import { toast } from 'sonner';
import type { ApiError } from '@/lib/api/errors';

/** Avisos curtos (sonner, com aria-live). Erro usa a mensagem do ApiError, já tratada. */
export const notify = {
  success: (message: string, description?: string) => toast.success(message, { description }),
  error: (error: ApiError) => toast.error(error.message),
};
