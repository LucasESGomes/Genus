import { createTenantBody as createTenantBodySchema } from '../../src/modules/super-admin/contract';
import { describe, expect, it } from 'vitest';
import { createTenantBody, findSensitiveKeys, invalidCnpj, isValidCnpj, validCnpj } from './super-admin';

describe('CNPJ de teste', () => {
  it.each([
    ['CNPJ conhecido e válido', '11222333000181'],
    ['gerado para n = 1', validCnpj(1)],
    ['gerado para n = 12345678', validCnpj(12345678)],
  ])('%s passa no validador', (_label, cnpj) => {
    expect(cnpj).toMatch(/^\d{14}$/);
    expect(isValidCnpj(cnpj)).toBe(true);
  });

  it('validCnpj(11222333) reproduz o CNPJ conhecido', () => {
    expect(validCnpj(11222333)).toBe('11222333000181');
  });

  it('CNPJ com verificador errado é recusado', () => {
    expect(isValidCnpj('11222333000182')).toBe(false);
    expect(isValidCnpj(invalidCnpj())).toBe(false);
    expect(invalidCnpj()).toMatch(/^\d{14}$/);
  });

  it('formato inválido é recusado', () => {
    expect(isValidCnpj('1122233300018')).toBe(false);
    expect(isValidCnpj('11.222.333/0001-81')).toBe(false);
  });
});

describe('createTenantBody', () => {
  it('gera corpo aceito pelo schema de POST /tenants', () => {
    const body = createTenantBody({ n: 3 });
    expect(() => createTenantBodySchema.parse(body)).not.toThrow();
    expect(body.name).toBe('Empresa Fictícia 3 Ltda');
    expect(body.establishment.registration).toBe(body.company.cnpj);
    expect(body.establishment.registrationType).toBe('CNPJ');
    expect(body.admin.email).toBe('admin.3@cliente.teste.dev');
  });

  it('overrides substituem campos de topo', () => {
    const body = createTenantBody({ n: 2, admin: { name: 'Ana Teste', email: 'ana@cliente.teste.dev' } });
    expect(body.admin).toEqual({ name: 'Ana Teste', email: 'ana@cliente.teste.dev' });
  });
});

describe('findSensitiveKeys', () => {
  it('acha chaves sensíveis aninhadas, em objetos e arrays', () => {
    const json = {
      data: {
        name: 'Empresa Fictícia 1 Ltda',
        admins: [{ id: 1, passwordHash: 'x' }, { id: 2, mfaSecret: 'y' }],
        meta: { apiToken: 'z', cpfs: [] },
      },
    };
    expect(findSensitiveKeys(json).sort()).toEqual(
      ['data.admins.0.passwordHash', 'data.admins.1.mfaSecret', 'data.meta.apiToken', 'data.meta.cpfs'].sort(),
    );
  });

  it('não acusa chaves seguras nem valores', () => {
    expect(findSensitiveKeys({ name: 'token', data: ['cpf'], id: 1 })).toEqual([]);
  });

  it('respeita allow por nome de chave e por caminho exato', () => {
    const json = { senhaTemporaria: 'abc', admin: { passwordHash: 'x' } };
    expect(findSensitiveKeys(json, ['senhaTemporaria'])).toEqual(['admin.passwordHash']);
    expect(findSensitiveKeys(json, ['admin.passwordHash'])).toEqual(['senhaTemporaria']);
  });

  it('chave com "senha" é sensível mesmo com prefixo', () => {
    expect(findSensitiveKeys({ temporarySenha: 'abc' })).toEqual(['temporarySenha']);
  });

  it('aceita valores primitivos e nulos', () => {
    expect(findSensitiveKeys(null)).toEqual([]);
    expect(findSensitiveKeys('texto')).toEqual([]);
  });
});
