import { describe, expect, it } from 'vitest';
import {
  AUDIT_ACTION_LABEL,
  AUDIT_ENTITY_LABEL,
  HEALTH_SERVICE_LABEL,
  HEALTH_STATE_LABEL,
  IP_FLAG_REASON_LABEL,
  LOGIN_FAILURE_LABEL,
  LOGIN_STEP_LABEL,
  MODULE_USAGE_LABEL,
  RECOGNITION_UNAVAILABLE_TEXT,
  SUPER_ADMIN_EMPTY,
  SUPER_ADMIN_ERRORS,
  TEMP_PASSWORD_WARNING,
  TENANT_STATUS_LABEL,
  WINDOW_LABEL,
  auditEntityLabel,
  superAdminErrorMessage,
} from './super-admin';

const allNonEmptyStrings = (map: Record<string, unknown>) =>
  Object.entries(map).every(([, value]) => typeof value === 'string' && value.trim().length > 0);

describe('rótulos do super admin', () => {
  it('todo valor de cada mapa tem texto não vazio', () => {
    const maps: Record<string, Record<string, unknown>> = {
      TENANT_STATUS_LABEL,
      HEALTH_STATE_LABEL,
      HEALTH_SERVICE_LABEL,
      AUDIT_ACTION_LABEL,
      AUDIT_ENTITY_LABEL,
      LOGIN_STEP_LABEL,
      LOGIN_FAILURE_LABEL,
      IP_FLAG_REASON_LABEL,
      WINDOW_LABEL,
      MODULE_USAGE_LABEL,
      SUPER_ADMIN_ERRORS,
    };
    for (const [name, map] of Object.entries(maps)) {
      expect(Object.keys(map).length, name).toBeGreaterThan(0);
      expect(allNonEmptyStrings(map), name).toBe(true);
    }
  });

  it('cobre as chaves dos contratos (espelho dos valores de enumeração da api)', () => {
    expect(Object.keys(TENANT_STATUS_LABEL).sort()).toEqual(['ativa', 'suspensa']);
    expect(Object.keys(HEALTH_STATE_LABEL).sort()).toEqual(['degraded', 'down', 'ok']);
    expect(Object.keys(HEALTH_SERVICE_LABEL)).toHaveLength(8);
    expect(Object.keys(AUDIT_ACTION_LABEL)).toHaveLength(8);
    expect(Object.keys(WINDOW_LABEL).sort()).toEqual(['24h', '30d', '7d']);
    expect(Object.keys(MODULE_USAGE_LABEL).sort()).toEqual(['absences', 'adjustments', 'certificates', 'closings', 'vacations']);
  });

  it('auditEntityLabel devolve o rótulo conhecido e o valor cru quando desconhecido', () => {
    expect(auditEntityLabel('tenant')).toBe(AUDIT_ENTITY_LABEL.tenant);
    expect(auditEntityLabel('entidade_nova')).toBe('entidade_nova');
    expect(auditEntityLabel('constructor')).toBe('constructor');
  });

  it('superAdminErrorMessage usa a mensagem do código e cai na genérica', () => {
    expect(superAdminErrorMessage('EMAIL_IN_USE')).toBe(SUPER_ADMIN_ERRORS.EMAIL_IN_USE);
    expect(superAdminErrorMessage('MASTER_KEY_AUSENTE')).toContain('MASTER_KEY');
    const generic = superAdminErrorMessage(undefined);
    expect(generic.trim().length).toBeGreaterThan(0);
    expect(superAdminErrorMessage('CODIGO_QUE_NAO_EXISTE')).toBe(generic);
    expect(superAdminErrorMessage('')).toBe(generic);
    expect(superAdminErrorMessage('toString')).toBe(generic);
  });

  it('estados vazios têm título e descrição', () => {
    for (const [screen, text] of Object.entries(SUPER_ADMIN_EMPTY)) {
      expect(text.title.trim(), `${screen}.title`).not.toBe('');
      expect(text.description.trim(), `${screen}.description`).not.toBe('');
    }
    expect(Object.keys(SUPER_ADMIN_EMPTY)).toHaveLength(9);
  });

  it('textos fixos não vazios', () => {
    expect(RECOGNITION_UNAVAILABLE_TEXT).toBe('Indisponível: depende do coletor gravar as tentativas');
    expect(TEMP_PASSWORD_WARNING.length).toBeGreaterThan(0);
  });
});
