'use client';
/**
 * Campos de empresa e estabelecimento: CNPJ com máscara, razão social preenchida pela consulta do CNPJ,
 * UF em lista e município pelo IBGE. Se uma consulta pública não responder, o campo aceita digitação.
 */
import { CaretUpDown } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { Field, SelectField, TextInput } from '@/components/ui/Fields';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/shadcn/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/shadcn/popover';
import { isValidCnpj, maskCaepf, maskCnpj, onlyDigits } from '@/lib/cnpj';
import { maskCpf } from '@/lib/cpf';
import { useSession } from '@/lib/session';
import { UF_OPTIONS } from '@/lib/uf';
import { COPY } from './copy';

const f = COPY.create.fields;

type MaskedProps = Omit<ComponentProps<typeof TextInput>, 'onChange' | 'value'> & { value: string; onValueChange: (value: string) => void };

export function CnpjInput({ value, onValueChange, ...rest }: MaskedProps) {
  return <TextInput inputMode="numeric" autoComplete="off" placeholder="00.000.000/0000-00" {...rest} value={value} onChange={(e) => onValueChange(maskCnpj(e.target.value))} />;
}

const REGISTRATION = {
  CPF: { label: 'CPF', mask: maskCpf, placeholder: '000.000.000-00' },
  CAEPF: { label: 'CAEPF', mask: maskCaepf, placeholder: '000.000.000/000-00' },
  CNPJ: { label: f.branchCnpj, mask: maskCnpj, placeholder: '00.000.000/0000-00' },
} as const;

export const maskRegistration = (type: keyof typeof REGISTRATION, value: string) => REGISTRATION[type].mask(value);

/** Número de inscrição do estabelecimento. Com tipo CNPJ só aparece para filial (quem decide é quem chama). */
export function RegistrationInput({ type, value, onValueChange, ...rest }: Omit<MaskedProps, 'label'> & { type: keyof typeof REGISTRATION }) {
  const r = REGISTRATION[type];
  return (
    <TextInput
      label={r.label}
      required
      hint={type === 'CNPJ' ? f.branchCnpjHint : undefined}
      inputMode="numeric"
      autoComplete="off"
      placeholder={r.placeholder}
      {...rest}
      value={value}
      onChange={(e) => onValueChange(r.mask(e.target.value))}
    />
  );
}

/**
 * Consulta a razão social quando o CNPJ fica completo e válido. Preenche uma vez por CNPJ e nunca por cima
 * do que a pessoa digitou. Na edição, o CNPJ que já estava salvo não é consultado.
 */
export function useLegalNameFromCnpj({ cnpj, savedCnpj = '', getLegalName, onFound }: {
  cnpj: string;
  savedCnpj?: string;
  getLegalName: () => string;
  onFound: (legalName: string) => void;
}): string | undefined {
  const { api } = useSession();
  const digits = onlyDigits(cnpj);
  const enabled = digits !== onlyDigits(savedCnpj) && isValidCnpj(digits);
  const query = useQuery({
    queryKey: ['genus-lookup', 'cnpj', digits],
    queryFn: ({ signal }) => api.lookup.company(digits, signal),
    enabled,
    staleTime: Infinity,
    retry: false,
  });
  const applied = useRef('');
  const filled = useRef('');
  // Na edição, a razão social salva pode ser trocada pela do CNPJ novo.
  const savedLegalName = useRef(savedCnpj ? getLegalName().trim() : '');
  useEffect(() => {
    const found = query.data?.legalName;
    if (!enabled || !found || applied.current === digits) return;
    applied.current = digits;
    const current = getLegalName().trim();
    if (current === '' || current === filled.current || current === savedLegalName.current) {
      filled.current = found;
      onFound(found);
    }
  });

  if (!enabled) return undefined;
  if (query.isFetching) return f.cnpjLookup.loading;
  if (query.isError) return f.cnpjLookup.failed;
  if (query.data === null) return f.cnpjLookup.missing;
  return query.data ? f.cnpjLookup.found : undefined;
}

export function UfField({ value, onValueChange, error }: { value: string; onValueChange: (uf: string) => void; error?: string }) {
  return <SelectField label={f.uf} required value={value} onValueChange={onValueChange} options={UF_OPTIONS} error={error} />;
}

const plain = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/** Município da UF, com busca. O valor é o código IBGE de 7 dígitos. */
export function MunicipalityField({ uf, value, onValueChange, error }: { uf: string; value: string; onValueChange: (id: string) => void; error?: string }) {
  const { api } = useSession();
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: ['genus-lookup', 'municipalities', uf],
    queryFn: ({ signal }) => api.lookup.municipalities(uf, signal),
    enabled: uf !== '',
    staleTime: Infinity,
    retry: 1,
  });

  if (uf !== '' && query.isError) {
    return (
      <TextInput
        label={f.municipalityCode} required inputMode="numeric" maxLength={7} autoComplete="off"
        hint="A lista do IBGE não respondeu. Digite o código." error={error}
        value={value} onChange={(e) => onValueChange(onlyDigits(e.target.value))}
      />
    );
  }

  const list = query.data ?? [];
  const selected = list.find((m) => m.id === value);
  const loading = uf !== '' && query.isPending;
  const placeholder = uf === '' ? 'Escolha a UF primeiro' : loading ? 'Carregando municípios…' : 'Selecione';

  return (
    <Field label={f.municipalityIbge} required error={error}>
      {(c) => (
        // modal: dentro de um diálogo, sem isso a lista não rola com a roda do mouse.
        <Popover modal open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              {...c}
              type="button"
              role="combobox"
              aria-expanded={open}
              disabled={uf === '' || loading}
              className="flex h-10 w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-line-strong bg-white px-3 text-left text-sm disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className={selected ? 'truncate' : 'truncate text-muted'}>{selected?.name ?? placeholder}</span>
              <CaretUpDown size={16} className="shrink-0 text-muted" aria-hidden />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-(--radix-popover-trigger-width) p-0">
            <Command filter={(name, search) => (plain(name).includes(plain(search)) ? 1 : 0)}>
              <CommandInput aria-label="Buscar município" placeholder="Buscar município" />
              <CommandList>
                <CommandEmpty>Nenhum município encontrado.</CommandEmpty>
                {list.map((m) => (
                  <CommandItem key={m.id} value={m.name} onSelect={() => { onValueChange(m.id); setOpen(false); }}>{m.name}</CommandItem>
                ))}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}
    </Field>
  );
}
