'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, type DefaultValues, type FieldValues, type Path, type UseFormReturn } from 'react-hook-form';
import type { z } from 'zod';
import type { ApiError } from '@/lib/api/errors';

/** react-hook-form com o schema Zod como única fonte de validação. */
export function useZodForm<S extends z.ZodType<FieldValues, FieldValues>>(schema: S, defaults: DefaultValues<z.input<S>>) {
  return useForm<z.input<S>, unknown, z.output<S>>({
    resolver: zodResolver(schema),
    defaultValues: defaults,
  });
}

/** `body.motivo` e `motivo` apontam para o mesmo campo. */
const fieldName = (path: string) => path.replace(/^(body|data)\./, '');

/**
 * Pendura os erros 422 (`details[].path`) nos campos e leva o foco ao primeiro com erro.
 * Devolve a mensagem geral quando não há campo para ela (exibir acima do botão de enviar).
 */
export function applyApiErrors<T extends FieldValues>(
  form: Pick<UseFormReturn<T>, 'setError' | 'setFocus'>,
  error: ApiError,
): string | null {
  const known = error.fields.map((f) => ({ name: fieldName(f.path) as Path<T>, message: f.message }));
  if (known.length === 0) return error.message;
  for (const f of known) form.setError(f.name, { type: 'server', message: f.message });
  const first = known[0];
  if (first) form.setFocus(first.name);
  return null;
}
