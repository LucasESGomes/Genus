'use client';
/** Peças de tela do portal do funcionário: folha inferior, alerta de formulário, escolha em cartões e remapeamento de erros. */
import { WarningCircle } from '@phosphor-icons/react';
import { useId, type ReactNode } from 'react';
import { ApiError } from '@/lib/api/errors';
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/shadcn/drawer';
import { RadioGroup, RadioGroupItem } from '@/components/ui/shadcn/radio-group';

/** Folha inferior (vaul). O foco fica preso nela e volta ao botão que a abriu. */
export function PortalSheet({ open, onOpenChange, title, description, children }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="mx-auto w-full max-w-[480px]">
        <DrawerHeader>
          <DrawerTitle className="text-lg font-bold">{title}</DrawerTitle>
          <DrawerDescription>{description}</DrawerDescription>
        </DrawerHeader>
        <div className="flex flex-col gap-4 overflow-y-auto px-4 pb-6">{children}</div>
      </DrawerContent>
    </Drawer>
  );
}

/** Esqueleto de carregamento anunciado ao leitor de tela. */
export function LoadingBlock({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div role="status" aria-busy="true" aria-label="Carregando" className={className}>{children}</div>;
}

/** Mensagem geral de erro (a api já manda em pt-BR). */
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

export interface ChoiceOption { value: string; label: string; hint?: string }

/** Escolha de uma opção em cartões de pelo menos 48 px (alvo de toque). */
export function ChoiceGroup({ legend, value, onValueChange, options, error }: {
  legend: string;
  value: string;
  onValueChange: (value: string) => void;
  options: ChoiceOption[];
  error?: string;
}) {
  const id = useId();
  const errorId = error ? `${id}-error` : undefined;
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0">
      <legend className="mb-1.5 p-0 text-sm font-semibold text-ink">{legend}</legend>
      <RadioGroup value={value} onValueChange={onValueChange} aria-describedby={errorId} aria-invalid={error ? true : undefined} className="gap-2">
        {options.map((o) => (
          <label
            key={o.value}
            htmlFor={`${id}-${o.value}`}
            className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-md border px-3 py-2 ${value === o.value ? 'border-brand bg-tint' : 'border-line-strong bg-white'}`}
          >
            <RadioGroupItem id={`${id}-${o.value}`} value={o.value} />
            <span className="flex flex-col">
              <span className="text-sm font-semibold">{o.label}</span>
              {o.hint && <span className="text-xs text-muted">{o.hint}</span>}
            </span>
          </label>
        ))}
      </RadioGroup>
      {error && <p id={errorId} className="m-0 text-xs font-medium text-danger">{error}</p>}
    </fieldset>
  );
}
