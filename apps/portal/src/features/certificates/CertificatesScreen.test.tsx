import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import type { CertificateAnalysis, Paged, Role } from '@/lib/api/contracts';
import type { Certificate, CertificateRh } from '@/lib/api/contracts';
import { ApiError } from '@/lib/api/errors';
import { MOCK_SESSION_KEY } from '@/lib/api/mocks';
import { mockCertificatesApi, resetMockCertificates } from '@/lib/api/mocks/certificates';
import { renderWithSession } from '../../../test/render';
import { router } from '../../../test/navigation';
import { CertificatesScreen } from './CertificatesScreen';

type R = Exclude<Role, 'super_admin'>;

const asSession = (role: R) => window.sessionStorage.setItem(MOCK_SESSION_KEY, JSON.stringify({ role, pending2fa: false }));

function desktop(matches: boolean) {
  window.matchMedia = ((query: string) => ({
    matches, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

const mockList = async (): Promise<Paged<Certificate | CertificateRh>> => mockCertificatesApi.list({ pageSize: 100 });

function setup(role: R = 'rh', route = '/rh/atestados', overrides: Partial<typeof mockCertificatesApi> = {}) {
  asSession(role);
  const spies = {
    list: vi.fn(overrides.list ?? mockCertificatesApi.list),
    file: vi.fn(overrides.file ?? mockCertificatesApi.file),
    approve: vi.fn(overrides.approve ?? mockCertificatesApi.approve),
    reject: vi.fn(overrides.reject ?? mockCertificatesApi.reject),
    analyze: vi.fn(overrides.analyze ?? mockCertificatesApi.analyze),
    analyses: vi.fn(overrides.analyses ?? mockCertificatesApi.analyses),
  };
  const view = renderWithSession(<CertificatesScreen />, { role, route, api: { certificates: spies } });
  return { ...view, ...spies };
}

beforeEach(() => {
  resetMockCertificates();
  desktop(true);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('Atestados: fila', () => {
  it('mostra o skeleton enquanto carrega', () => {
    setup('rh', '/rh/atestados', { list: () => new Promise(() => {}) });
    expect(screen.getByLabelText('Carregando')).toHaveAttribute('aria-busy', 'true');
  });

  it('mostra a fila com nomes do cache de colaboradores e contagens por aba (status da api)', async () => {
    const { container } = setup();
    expect(await screen.findByRole('button', { name: /Rita de Cássia Moura/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Pendentes/ })).toHaveTextContent('4');
    expect(screen.getByRole('tab', { name: /Decididos/ })).toHaveTextContent('2');
    expect(screen.getByRole('tab', { name: /Todos/ })).toHaveTextContent('6');
    // Aba padrão = pendentes: os decididos não aparecem.
    expect(screen.queryByRole('button', { name: /Joaquim Mendes/ })).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('a aba na URL filtra a fila', async () => {
    setup('rh', '/rh/atestados?aba=decididos');
    expect(await screen.findByRole('button', { name: /Joaquim Mendes/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sebastião Prado/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Rita de Cássia/ })).toBeNull();
  });

  it('clicar num atestado põe só o ID opaco na URL', async () => {
    setup();
    await userEvent.click(await screen.findByRole('button', { name: /Rita de Cássia Moura/ }));
    expect(router.replace).toHaveBeenCalledWith('/rh/atestados?id=1', { scroll: false });
  });

  it('fila vazia mostra o estado vazio com "Ver decididos"', async () => {
    setup('rh', '/rh/atestados', { list: async () => ({ data: [], meta: { page: 1, pageSize: 100, total: 0 } }) });
    expect(await screen.findByText('Nenhum atestado pendente')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Ver decididos' }));
    expect(router.replace).toHaveBeenCalledWith('/rh/atestados?aba=decididos', { scroll: false });
  });

  it('erro 5xx mostra "Tentar de novo" e busca de novo', async () => {
    const { list } = setup('rh', '/rh/atestados', { list: async () => { throw new ApiError('server', 503, 'HTTP_503', 'x'); } });
    await userEvent.click(await screen.findByRole('button', { name: /Tentar de novo/ }));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  });

  it('403 e 404 mostram a mesma tela', async () => {
    const view = setup('rh', '/rh/atestados', { list: async () => { throw new ApiError('forbidden', 403, 'FORBIDDEN', 'x'); } });
    expect(await screen.findByText('Item não encontrado')).toBeInTheDocument();
    view.unmount();
    setup('rh', '/rh/atestados', { list: async () => { throw new ApiError('not_found', 404, 'NOT_FOUND', 'x'); } });
    expect(await screen.findByText('Item não encontrado')).toBeInTheDocument();
  });

  it('"em breve" quando o back não tem o módulo', async () => {
    setup('rh', '/rh/atestados', { list: async () => { throw new ApiError('unavailable', 0, 'EM_BREVE', 'x'); } });
    expect(await screen.findByText(/Em breve/)).toBeInTheDocument();
  });

  it('colaborador não acessa a tela e não dispara a busca', async () => {
    const { list } = setup('colaborador');
    expect(await screen.findByText('Sem permissão para esta tela')).toBeInTheDocument();
    expect(list).not.toHaveBeenCalled();
  });

  it('"Abrir próximo da fila" seleciona o próximo pendente depois do atual', async () => {
    setup('rh', '/rh/atestados?id=1');
    await userEvent.click(await screen.findByRole('button', { name: 'Abrir próximo da fila' }));
    // Ordem da fila: enviado mais recente primeiro: 1, 2, 3, 4.
    expect(router.replace).toHaveBeenCalledWith('/rh/atestados?id=2&aba=pendentes', { scroll: false });
  });

  it('id inválido na URL mostra "não encontrado" sem chamar análises', async () => {
    const { analyses } = setup('rh', '/rh/atestados?id=abc');
    expect(await screen.findByText('Item não encontrado')).toBeInTheDocument();
    expect(analyses).not.toHaveBeenCalled();
  });

  it('abaixo de 1024 px o detalhe abre no painel lateral', async () => {
    desktop(false);
    setup('rh', '/rh/atestados?id=1');
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Rita de Cássia Moura')).toBeInTheDocument();
    expect(await within(dialog).findByText(/Análise automática e indicativa/)).toBeInTheDocument();
  });
});

describe('Atestados: detalhe do RH', () => {
  it('mostra campos conferidos, CID, risco, achados, confiabilidade e o aviso da análise', async () => {
    const { container } = setup('rh', '/rh/atestados?id=1');
    expect(await screen.findByText('Campos conferidos')).toBeInTheDocument();
    expect(screen.getByText('J11')).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: 'Nota de risco' })).toHaveAttribute('aria-valuenow', '46');
    expect(screen.getByText(/Recorrência em sextas-feiras/)).toBeInTheDocument();
    expect(screen.getByText(/Confiabilidade da leitura: Média/)).toBeInTheDocument();
    expect(screen.getByText(/Henrique Vasconcelos · CRM 18442\/GO/)).toBeInTheDocument();
    expect(screen.getByText(/Análise automática e indicativa/)).toBeInTheDocument();
    expect(screen.getByText(/não altera o status do atestado nem comprova a autenticidade/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('o aviso (notice) aparece mesmo quando a IA falhou, e só as regras são mostradas', async () => {
    const analysis: CertificateAnalysis = {
      ...(await mockCertificatesApi.analyses('1'))[0]!,
      ai: { status: 'falhou', failure: 'tempo_esgotado' },
      cid: [
        { code: 'J11', chapter: 'X', chapterTitle: 'Respiratório', status: 'valido', confidence: 1, source: 'regra' },
        { code: 'Z99', chapter: 'XXI', chapterTitle: 'Da IA', status: 'valido', confidence: 0.4, source: 'ia' },
      ],
    };
    setup('rh', '/rh/atestados?id=1', { analyses: async () => [analysis] });
    expect(await screen.findByText(/A leitura por IA falhou/)).toBeInTheDocument();
    expect(screen.getByText(/Análise automática e indicativa/)).toBeInTheDocument();
    expect(screen.getByText('J11')).toBeInTheDocument();
    expect(screen.queryByText('Z99')).toBeNull();
    expect(screen.getByText(/IA falhou: Tempo esgotado/)).toBeInTheDocument();
  });

  it('atestado sem análise mostra a etapa derivada "Recebido"', async () => {
    setup('rh', '/rh/atestados?id=2');
    expect(await screen.findByText(/Etapa na fila \(derivada\): Recebido/)).toBeInTheDocument();
    expect(screen.getByText('Nenhuma análise feita para este atestado.')).toBeInTheDocument();
  });

  it('abre o arquivo como Blob em outra aba e revoga a URL ao desmontar', async () => {
    const create = vi.fn(() => 'blob:fake-1');
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const tab = { location: { href: '' }, close: vi.fn(), opener: {} };
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    const { file, unmount } = setup('rh', '/rh/atestados?id=1');
    await userEvent.click(await screen.findByRole('button', { name: 'Ver arquivo do atestado' }));
    await waitFor(() => expect(tab.location.href).toBe('blob:fake-1'));
    expect(file).toHaveBeenCalledWith('1');
    expect(create).toHaveBeenCalledWith(expect.any(Blob));
    expect(revoke).not.toHaveBeenCalled();
    unmount();
    expect(revoke).toHaveBeenCalledWith('blob:fake-1');
  });
});

describe('Atestados: análise com IA', () => {
  it('o texto colado é limpo ao trocar de atestado', async () => {
    const view = setup('rh', '/rh/atestados?id=2');
    const box = await screen.findByLabelText(/Texto do atestado/);
    await userEvent.type(box, 'Atesto que o paciente esteve em consulta hoje.');
    expect(box).toHaveValue('Atesto que o paciente esteve em consulta hoje.');
    // Troca de item (a URL mudou): o formulário é remontado, sem o texto.
    const { setRoute } = await import('../../../test/navigation');
    setRoute('/rh/atestados?id=3');
    view.rerender(<CertificatesScreen />);
    await waitFor(() => expect(screen.getByLabelText(/Texto do atestado/)).toHaveValue(''));
  });

  it('exige 20 caracteres e mostra o contador; envia texto e modelos ao endpoint', async () => {
    const { analyze } = setup('rh', '/rh/atestados?id=2', { analyze: async (id) => mockCertificatesApi.analyze(id, { text: 'x'.repeat(30) }) });
    const box = await screen.findByLabelText(/Texto do atestado/);
    const button = screen.getByRole('button', { name: 'Analisar com IA' });
    await userEvent.type(box, 'curto');
    expect(button).toBeDisabled();
    expect(screen.getByText(/5 de 20\.000 caracteres/)).toBeInTheDocument();
    await userEvent.clear(box);
    await userEvent.type(box, 'Atesto que o paciente esteve em consulta hoje.');
    await userEvent.type(screen.getByLabelText(/Modelos para comparar/), 'anthropic:claude-x');
    await userEvent.click(button);
    await waitFor(() => expect(analyze).toHaveBeenCalledWith('2', { text: 'Atesto que o paciente esteve em consulta hoje.', models: ['anthropic:claude-x'] }));
    // O texto some depois de enviado.
    await waitFor(() => expect(screen.getByLabelText(/Texto do atestado/)).toHaveValue(''));
  });

  it('recusa modelo no formato errado e mais de 4 modelos', async () => {
    setup('rh', '/rh/atestados?id=2');
    await userEvent.type(await screen.findByLabelText(/Texto do atestado/), 'Atesto que o paciente esteve em consulta hoje.');
    const models = screen.getByLabelText(/Modelos para comparar/);
    await userEvent.type(models, 'semdoispontos');
    expect(screen.getByText(/Use o formato provedor:modelo/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Analisar com IA' })).toBeDisabled();
    await userEvent.clear(models);
    await userEvent.type(models, 'anthropic:a,anthropic:b,anthropic:c,anthropic:d,anthropic:e');
    expect(screen.getByText(/no máximo 4 modelos/)).toBeInTheDocument();
  });

  it('mostra "Lendo atestado…" enquanto analisa e o resultado depois, sem mudar o status', async () => {
    let finish: () => void = () => {};
    const gate = new Promise<void>((r) => { finish = r; });
    const { analyze, list } = setup('rh', '/rh/atestados?id=2', {
      analyze: async (id, body) => { await gate; return mockCertificatesApi.analyze(id, body); },
    });
    await userEvent.type(await screen.findByLabelText(/Texto do atestado/), 'Atesto que o paciente esteve em consulta hoje.');
    await userEvent.click(screen.getByRole('button', { name: 'Analisar com IA' }));
    expect(await screen.findByText('Lendo atestado…')).toBeInTheDocument();
    finish();
    expect(await screen.findByText(/Análise automática e indicativa/)).toBeInTheDocument();
    expect(screen.getByText(/IA simulada/)).toBeInTheDocument();
    expect(analyze).toHaveBeenCalledTimes(1);
    await expect(analyze.mock.results[0]?.value).resolves.toMatchObject({ certificateStatus: 'pendente' });
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('dois modelos geram a comparação', async () => {
    const mocks = process.env.NEXT_PUBLIC_USE_MOCKS;
    process.env.NEXT_PUBLIC_USE_MOCKS = 'true';
    try {
      setup('rh', '/rh/atestados?id=2');
      await userEvent.type(await screen.findByLabelText(/Texto do atestado/), 'Atesto que o paciente esteve em consulta hoje.');
      await userEvent.type(screen.getByLabelText(/Modelos para comparar/), 'mock:v1, mock:v2');
      await userEvent.click(screen.getByRole('button', { name: 'Analisar com IA' }));
      expect(await screen.findByRole('region', { name: 'Comparação entre modelos' })).toBeInTheDocument();
    } finally {
      if (mocks === undefined) delete process.env.NEXT_PUBLIC_USE_MOCKS;
      else process.env.NEXT_PUBLIC_USE_MOCKS = mocks;
    }
  });
});

describe('Atestados: decisão', () => {
  it('aprovar confirma, chama approve(id), avisa e invalida a lista e as análises', async () => {
    const success = vi.spyOn(toast, 'success');
    const { approve, list, analyses } = setup('rh', '/rh/atestados?id=2');
    await userEvent.click(await screen.findByRole('button', { name: 'Aprovar' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(approve).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Aprovar atestado' }));
    await waitFor(() => expect(approve).toHaveBeenCalledWith('2'));
    await waitFor(() => expect(success).toHaveBeenCalledWith('Atestado aprovado', { description: 'Os dias serão recalculados' }));
    await waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(1));
    await waitFor(() => expect(analyses.mock.calls.length).toBeGreaterThan(1));
    // O item decidido é imutável: sem botões, com a data da decisão.
    expect(await screen.findByText(/Aprovado em /)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aprovar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Recusar' })).toBeNull();
  });

  it('recusar exige motivo de 3 caracteres e chama reject(id, { reason })', async () => {
    const { reject } = setup('rh', '/rh/atestados?id=2');
    await userEvent.click(await screen.findByRole('button', { name: 'Recusar' }));
    const dialog = await screen.findByRole('alertdialog');
    const confirm = within(dialog).getByRole('button', { name: 'Recusar atestado' });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/Motivo da recusa/), 'ab');
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/Motivo da recusa/), 'c');
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    await waitFor(() => expect(reject).toHaveBeenCalledWith('2', { reason: 'abc' }));
  });

  it('409 (já decidido por outra pessoa): avisa e recarrega o item', async () => {
    const error = vi.spyOn(toast, 'error');
    const { list } = setup('rh', '/rh/atestados?id=2', {
      approve: async () => { throw new ApiError('conflict', 409, 'STATUS_INVALIDO', 'O atestado já foi decidido'); },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Aprovar' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Aprovar atestado' }));
    await waitFor(() => expect(error).toHaveBeenCalledWith('O atestado já foi decidido'));
    await waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(1));
  });

  it('item decidido não tem botões e mostra o motivo da recusa ao RH', async () => {
    setup('rh', '/rh/atestados?id=6');
    expect(await screen.findByText(/Recusado em /)).toBeInTheDocument();
    expect(screen.getByText(/Motivo da recusa: /)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aprovar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Recusar' })).toBeNull();
    expect(screen.queryByLabelText(/Texto do atestado/)).toBeNull();
  });
});

describe('Atestados: perfis sem acesso ao dado sensível', () => {
  it.each<R>(['admin', 'gestor'])('%s: sem médico, arquivo, CID, análise nem botões de decisão', async (role) => {
    const { container, analyses, file } = setup(role, '/rh/atestados?id=1');
    expect(await screen.findByText('Aguardando decisão do RH')).toBeInTheDocument();
    expect(screen.getByText('Dado sensível restrito')).toBeInTheDocument();
    expect(screen.getByText('Arquivo restrito ao RH')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ver arquivo do atestado' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Aprovar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Recusar' })).toBeNull();
    expect(screen.queryByText('Análise do atestado')).toBeNull();
    expect(screen.queryByLabelText(/Texto do atestado/)).toBeNull();
    expect(screen.queryByText(/Henrique Vasconcelos/)).toBeNull();
    expect(container.innerHTML).not.toContain('J11');
    expect(container.innerHTML).not.toContain('Henrique');
    expect(analyses).not.toHaveBeenCalled();
    expect(file).not.toHaveBeenCalled();
  });
});

describe('Mock de atestados', () => {
  it('aprovar muda o que a próxima leitura devolve e repetir dá 409 STATUS_INVALIDO', async () => {
    asSession('rh');
    await mockCertificatesApi.approve('2');
    const after = (await mockList()).data.find((c) => c.id === '2');
    expect(after?.status).toBe('aprovado');
    await expect(mockCertificatesApi.approve('2')).rejects.toMatchObject({ status: 409, code: 'STATUS_INVALIDO' });
    await expect(mockCertificatesApi.reject('2', { reason: 'abc' })).rejects.toMatchObject({ status: 409 });
  });

  it('não-rh recebe a forma sem médico e sem arquivo; análise é 403; id desconhecido é 404', async () => {
    asSession('admin');
    const row = (await mockList()).data[0]!;
    expect('doctorName' in row).toBe(false);
    expect('fileUrl' in row).toBe(false);
    await expect(mockCertificatesApi.analyses('1')).rejects.toMatchObject({ status: 403 });
    asSession('rh');
    await expect(mockCertificatesApi.file('999')).rejects.toMatchObject({ status: 404 });
    const blob = await mockCertificatesApi.file('1');
    expect(blob.type).toBe('text/plain');
  });

  it('analisar acrescenta a análise e não muda o status', async () => {
    asSession('rh');
    const before = (await mockCertificatesApi.analyses('2')).length;
    const r = await mockCertificatesApi.analyze('2', { text: 'Atesto que o paciente esteve em consulta hoje.' });
    expect(r.certificateStatus).toBe('pendente');
    expect(r.analyses[0]?.notice).toMatch(/não comprova a autenticidade/i);
    expect((await mockCertificatesApi.analyses('2')).length).toBe(before + 1);
  });
});
