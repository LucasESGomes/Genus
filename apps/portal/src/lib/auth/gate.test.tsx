import { QueryClient } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Providers } from '@/app/providers';
import { ApiError } from '@/lib/api/errors';
import { mockEstablishments, mockMeFor } from '@/lib/api/mocks';
import { makeTestQueryClient } from '@/lib/query/client';
import { useApiQuery } from '@/lib/query/hooks';
import { useSession } from '@/lib/session';
import { router, setRoute } from '../../../test/navigation';
import { buildApi } from '../../../test/render';
import { AuthGate, safeNext, useSignOut } from './gate';

function Probe() {
  const { me, establishment, setEstablishmentId } = useSession();
  const signOut = useSignOut();
  const q = useApiQuery('employees', {}, async () => ['dado']);
  return (
    <div>
      <span>sessão de {me.name} em {establishment.name}</span>
      <span>{q.data?.[0]}</span>
      <button type="button" onClick={() => setEstablishmentId('2')}>trocar</button>
      <button type="button" onClick={() => void signOut()}>sair</button>
    </div>
  );
}

function mount(area: 'rh' | 'me', me: () => Promise<ReturnType<typeof mockMeFor>>, qc: QueryClient = makeTestQueryClient()) {
  const api = buildApi({ auth: { me: vi.fn(me), signOut: vi.fn(async () => {}) }, org: { establishments: vi.fn(async () => mockEstablishments) } });
  render(<Providers api={api} queryClient={qc}><AuthGate area={area}><Probe /></AuthGate></Providers>);
  return { api, qc };
}

describe('guarda de área', () => {
  it('sem sessão (401) manda para o login guardando só o caminho', async () => {
    setRoute('/rh/atestados');
    mount('rh', async () => { throw new ApiError('unauthenticated', 401, 'UNAUTHENTICATED', 'x'); });
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/login?next=%2Frh%2Fatestados'));
  });
  it('colaborador no painel de RH vai para /me', async () => {
    mount('rh', async () => mockMeFor('colaborador'));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/me'));
  });
  it('RH no portal do colaborador vê 403', async () => {
    mount('me', async () => mockMeFor('rh'));
    expect(await screen.findByText('Sem permissão para esta tela')).toBeInTheDocument();
  });
  it('gestor só vê os estabelecimentos do escopo, mesmo que a lista traga outros', async () => {
    setRoute('/rh?establishmentId=3');
    mount('rh', async () => mockMeFor('gestor'));
    // escopo do gestor = ['1']; o 3 da URL é ignorado
    expect(await screen.findByText(/em Fazenda Santa Helena/)).toBeInTheDocument();
  });
  it('trocar de estabelecimento limpa o cache de dados', async () => {
    const { qc } = mount('rh', async () => mockMeFor('rh'));
    await screen.findByText('dado');
    expect(qc.getQueryCache().findAll({ queryKey: ['genus'] })).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'trocar' }));
    await screen.findByText(/em Usina Boa Vista/);
    expect(qc.getQueryCache().findAll({ queryKey: ['genus', '1', '1', '1'] })).toHaveLength(0);
  });
  it('sair limpa todo o cache (dados e sessão) e volta ao login', async () => {
    const { qc, api } = mount('rh', async () => mockMeFor('rh'));
    await screen.findByText('dado');
    await userEvent.click(screen.getByRole('button', { name: 'sair' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/login'));
    expect(api.auth.signOut).toHaveBeenCalled();
    // Nenhum dado sobra em cache e nada volta a buscar (a guarda desmonta as telas antes de limpar).
    const left = qc.getQueryCache().getAll();
    expect(left.every((q) => q.state.data === undefined && q.state.fetchStatus === 'idle')).toBe(true);
    expect(qc.getQueryCache().findAll({ queryKey: ['genus'] })).toHaveLength(0);
    expect(screen.queryByText('dado')).toBeNull();
    expect(api.auth.me).toHaveBeenCalledTimes(1);
  });
});

describe('safeNext', () => {
  it.each([['/rh/atestados', '/rh/atestados'], ['/me', '/me'], ['//evil.com', null], ['https://evil.com', null], ['/\\evil', null], ['/login', null], [null, null]])(
    '%j → %j',
    (input, out) => expect(safeNext(input)).toBe(out),
  );
});
