'use client';
import { WarningCircle } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { ApiError } from '@/lib/api/errors';

/** Mensagem geral de erro de formulário (a api já manda em pt-BR). */
export function FormAlert({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="m-0 flex items-start gap-2 rounded-md border border-danger-line bg-danger-bg px-3 py-2 text-sm text-danger">
      <WarningCircle size={18} weight="fill" aria-hidden className="mt-px shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/** Troca o nome dos campos da api pelos do formulário (ex.: `proposedAt` → `time`). */
export function remapFields(error: ApiError, map: Record<string, string>): ApiError {
  return new ApiError(
    error.kind,
    error.status,
    error.code,
    error.message,
    error.fields.map((f) => ({ ...f, path: map[f.path.replace(/^(body|data)\./, '')] ?? f.path })),
  );
}
