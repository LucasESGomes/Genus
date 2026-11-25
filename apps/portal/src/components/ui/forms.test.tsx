import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { z } from 'zod';
import { ApiError, toApiError } from '@/lib/api/errors';
import { Avatar } from './Avatar';
import { CheckboxField, DateInput, Field, FileInput, SearchInput, SelectField, SwitchField, TextArea, TextInput, TimeInput } from './Fields';
import { KeyValueList } from './KeyValueList';
import { notify } from './notify';
import { StatusBadge } from './StatusBadge';
import { applyApiErrors, useZodForm } from './useZodForm';
import { toast } from 'sonner';

describe('campos', () => {
  it('liga rótulo, dica e erro ao controle', async () => {
    const { container } = render(<TextInput label="Nome" hint="Como no RG" error="Obrigatório" required />);
    const input = screen.getByLabelText(/Nome/);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Como no RG Obrigatório');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('Field aceita qualquer controle por render prop', () => {
    render(<Field label="Cor">{(c) => <input {...c} />}</Field>);
    expect(screen.getByLabelText('Cor')).toBeInTheDocument();
  });

  it('data, hora, área de texto e busca', async () => {
    const { container } = render(
      <>
        <DateInput label="Data" />
        <TimeInput label="Hora" />
        <TextArea label="Motivo" />
        <SearchInput label="Buscar pessoa" />
      </>,
    );
    expect(screen.getByLabelText('Data')).toHaveAttribute('type', 'date');
    expect(screen.getByLabelText('Hora')).toHaveAttribute('type', 'time');
    expect(screen.getByRole('textbox', { name: 'Motivo' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Buscar pessoa' })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('checkbox e switch chamam onCheckedChange', async () => {
    const a = vi.fn();
    const b = vi.fn();
    const { container } = render(
      <>
        <CheckboxField label="Aceito" checked={false} onCheckedChange={a} />
        <SwitchField label="Ativo" hint="Liga o totem" checked={false} onCheckedChange={b} />
      </>,
    );
    await userEvent.click(screen.getByRole('checkbox', { name: 'Aceito' }));
    expect(a).toHaveBeenCalledWith(true);
    await userEvent.click(screen.getByRole('switch', { name: 'Ativo' }));
    expect(b).toHaveBeenCalledWith(true);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('select mostra opções e devolve o valor', async () => {
    const onValueChange = vi.fn();
    const { container } = render(<SelectField label="Setor" value="" onValueChange={onValueChange} options={[{ value: '1', label: 'Colheita' }, { value: '2', label: 'Estufa' }]} />);
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(screen.getByRole('combobox', { name: 'Setor' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Estufa' }));
    expect(onValueChange).toHaveBeenCalledWith('2');
  });

  it('FileInput recusa arquivo grande e aceita o dentro do limite', async () => {
    const onFile = vi.fn();
    const { container } = render(<FileInput label="Atestado" accept="image/*" maxBytes={1024} capture="environment" onFile={onFile} />);
    expect(screen.getByLabelText('Atestado')).toHaveAttribute('capture', 'environment');
    const input = screen.getByLabelText('Atestado');
    await userEvent.upload(input, new File([new Uint8Array(2048)], 'grande.png', { type: 'image/png' }));
    expect(await screen.findByText(/passa do limite/)).toBeInTheDocument();
    expect(onFile).toHaveBeenLastCalledWith(null);
    await userEvent.upload(input, new File([new Uint8Array(10)], 'ok.png', { type: 'image/png' }));
    expect(onFile).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'ok.png' }));
    expect(await screen.findByText('Selecionado: ok.png')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});

const schema = z.object({ reason: z.string().min(3, 'Informe ao menos 3 caracteres') });

function FormHarness({ error }: { error?: ApiError }) {
  const form = useZodForm(schema, { reason: '' });
  const { register, handleSubmit, formState: { errors } } = form;
  return (
    <form onSubmit={handleSubmit(() => { if (error) applyApiErrors(form, error); })}>
      <TextInput label="Motivo" error={errors.reason?.message} {...register('reason')} />
      <button type="submit">Enviar</button>
    </form>
  );
}

describe('useZodForm / applyApiErrors', () => {
  it('valida com o schema', async () => {
    render(<FormHarness />);
    await userEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(await screen.findByText('Informe ao menos 3 caracteres')).toBeInTheDocument();
  });
  it('pendura o 422 no campo e foca nele', async () => {
    const err = toApiError(422, { error: 'Dados inválidos', code: 'VALIDACAO', details: [{ path: 'body.reason', message: 'Motivo já usado' }] });
    render(<FormHarness error={err} />);
    await userEvent.type(screen.getByLabelText('Motivo'), 'abcd');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(await screen.findByText('Motivo já usado')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Motivo')).toHaveFocus());
  });
  it('sem campos devolve a mensagem geral', () => {
    const form = { setError: vi.fn(), setFocus: vi.fn() };
    expect(applyApiErrors(form, new ApiError('conflict', 409, 'X', 'Já existe'))).toBe('Já existe');
    expect(form.setError).not.toHaveBeenCalled();
  });
});

describe('peças pequenas', () => {
  it('StatusBadge mostra ícone e texto por tom', async () => {
    const { container } = render(<>{(['good', 'warn', 'danger', 'neutral', 'info'] as const).map((t) => <StatusBadge key={t} tone={t} label={`Tom ${t}`} />)}</>);
    expect(screen.getByText('Tom danger')).toBeInTheDocument();
    expect(container.querySelectorAll('svg')).toHaveLength(5);
    expect(await axe(container)).toHaveNoViolations();
  });
  it('KeyValueList é uma dl', async () => {
    const { container } = render(<KeyValueList items={[{ label: 'Setor', value: 'Colheita' }, { label: 'Cargo', value: 'Operador' }]} />);
    expect(container.querySelectorAll('dt')).toHaveLength(2);
    expect(screen.getByText('Colheita').tagName).toBe('DD');
    expect(await axe(container)).toHaveNoViolations();
  });
  it('Avatar mostra iniciais escondidas do leitor de tela', () => {
    render(<Avatar name="Lúcia Martins" />);
    const el = screen.getByText('LM');
    expect(el).toHaveAttribute('aria-hidden', 'true');
  });
  it('notify usa a mensagem do ApiError', () => {
    const success = vi.spyOn(toast, 'success').mockReturnValue(1);
    const error = vi.spyOn(toast, 'error').mockReturnValue(2);
    notify.success('Salvo', 'Tudo certo');
    expect(success).toHaveBeenCalledWith('Salvo', { description: 'Tudo certo' });
    notify.error(new ApiError('conflict', 409, 'X', 'Já existe'));
    expect(error).toHaveBeenCalledWith('Já existe');
  });
});
