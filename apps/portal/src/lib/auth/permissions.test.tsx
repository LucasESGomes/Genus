import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CidValue } from '@/components/ui/SensitiveValue';
import type { Role } from '../api/contracts';
import { can, SENSITIVE_PLACEHOLDER } from './permissions';

const ALL: Role[] = ['super_admin', 'admin', 'rh', 'gestor', 'contador', 'colaborador'];

describe('regras de exibição', () => {
  it.each(ALL)('%s: CID e aprovar atestado só para o RH', (role) => {
    expect(can(role, 'certificate.viewCid')).toBe(role === 'rh');
    expect(can(role, 'certificate.approve')).toBe(role === 'rh');
  });
  it('admin vê "Dado sensível restrito" no lugar do CID', () => {
    render(<CidValue role="admin" value="J11" />);
    expect(screen.getByText(SENSITIVE_PLACEHOLDER)).toBeInTheDocument();
    expect(screen.queryByText('J11')).toBeNull();
  });
  it('RH vê o CID', () => {
    render(<CidValue role="rh" value="J11" />);
    expect(screen.getByText('J11')).toBeInTheDocument();
  });
  it('colaborador não entra no painel de RH', () => {
    expect(can('colaborador', 'rh.panel')).toBe(false);
    expect(can('colaborador', 'employee.portal')).toBe(true);
  });
});
