import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CidValue } from '@/components/ui/SensitiveValue';
import type { Role } from '../api/contracts';
import { can, homeFor, SENSITIVE_PLACEHOLDER } from './permissions';

const ALL: Role[] = ['super_admin', 'admin', 'rh', 'gestor', 'contador', 'colaborador'];

describe('regras de exibição', () => {
  it.each(ALL)('%s: CID, arquivo e aprovar atestado só para o RH', (role) => {
    expect(can(role, 'certificate.viewCid')).toBe(role === 'rh');
    expect(can(role, 'certificate.viewFile')).toBe(role === 'rh');
    expect(can(role, 'certificate.approve')).toBe(role === 'rh');
  });
  it('admin vê "Dado sensível restrito" no lugar do CID, e o valor nem entra no DOM', () => {
    const { container } = render(<CidValue role="admin" value="J11" />);
    expect(screen.getByText(SENSITIVE_PLACEHOLDER)).toBeInTheDocument();
    expect(container.innerHTML).not.toContain('J11');
  });
  it('RH vê o CID', () => {
    render(<CidValue role="rh" value="J11" />);
    expect(screen.getByText('J11')).toBeInTheDocument();
  });
  it('colaborador não entra no painel de RH; super_admin também não', () => {
    expect(can('colaborador', 'rh.panel')).toBe(false);
    expect(can('super_admin', 'rh.panel')).toBe(false);
    expect(can('colaborador', 'employee.portal')).toBe(true);
  });
  it('contador só vê fechamento, relatórios e colaboradores', () => {
    const navs = ['nav.overview', 'nav.employees', 'nav.timesheets', 'nav.adjustments', 'nav.vacations', 'nav.certificates', 'nav.timeBank', 'nav.closings', 'nav.reports', 'nav.devices', 'nav.settings'] as const;
    expect(navs.filter((a) => can('contador', a))).toEqual(['nav.employees', 'nav.closings', 'nav.reports']);
  });
  it('abono só o RH decide; gestor decide os demais ajustes', () => {
    expect(can('gestor', 'adjustment.decide')).toBe(true);
    expect(can('gestor', 'adjustment.decideAllowance')).toBe(false);
    expect(can('admin', 'adjustment.decide')).toBe(false);
  });
  it('totens: só rh e admin gerenciam', () => {
    expect(ALL.filter((r) => can(r, 'device.manage'))).toEqual(['admin', 'rh']);
  });
  it('colaborador: rh e admin cadastram, editam e desligam; vínculo segue só do rh', () => {
    for (const action of ['employee.create', 'employee.edit', 'employee.terminate'] as const) {
      expect(ALL.filter((r) => can(r, action))).toEqual(['admin', 'rh']);
    }
    expect(ALL.filter((r) => can(r, 'assignment.edit'))).toEqual(['rh']);
  });
  it('banco de horas: gestor vê saldos; a regra é consultada por rh e admin e editada só pelo rh', () => {
    expect(ALL.filter((r) => can(r, 'timeBank.view'))).toEqual(['admin', 'rh', 'gestor']);
    expect(ALL.filter((r) => can(r, 'timeBank.viewPolicy'))).toEqual(['admin', 'rh']);
    expect(ALL.filter((r) => can(r, 'timeBank.editPolicy'))).toEqual(['rh']);
  });
  it('usuários: só o admin convida', () => {
    expect(ALL.filter((r) => can(r, 'nav.users'))).toEqual(['admin']);
  });
  it('primeira tela por papel', () => {
    expect(homeFor('colaborador')).toBe('/me');
    expect(homeFor('contador')).toBe('/rh/fechamento');
    expect(homeFor('rh')).toBe('/rh');
    expect(homeFor('super_admin')).toBe('/admin');
  });
});
