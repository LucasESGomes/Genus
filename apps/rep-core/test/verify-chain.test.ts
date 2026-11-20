import { describe, expect, it } from 'vitest';
import { computeRecordHash, GENESIS_HASH } from '../src/nsr/hash';
import { type ChainRow, verifyChain } from '../src/nsr/verify-chain';

/** Gera cadeia válida; timestamps no formato do banco (6 casas, extras zero). */
function makeChain(n: number): ChainRow[] {
  const rows: ChainRow[] = [];
  let prev = GENESIS_HASH;
  for (let i = 1; i <= n; i++) {
    const marcado = `2026-11-20T12:00:0${i}.100Z`;
    const gravado = `2026-11-20T12:00:0${i}.200Z`;
    const hash = computeRecordHash(
      { nsr: i, tipo: '7', marcadoEm: marcado, cpf: '12345678901', gravadoEm: gravado, tipoColetor: '01', ehOffline: false },
      prev,
    );
    rows.push({
      nsr: i, tipo: '7', cpf: '12345678901', tipoColetor: '01', ehOffline: false,
      marcadoEm: marcado.replace('Z', '000Z'), gravadoEm: gravado.replace('Z', '000Z'),
      hash, hashAnterior: prev, versaoFormatoHash: 1,
    });
    prev = hash;
  }
  return rows;
}

describe('verifyChain', () => {
  it('cadeia válida de 5 linhas', () => {
    const rows = makeChain(5);
    const r = verifyChain(rows);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.rowsChecked).toBe(5);
    expect(r.lastNsr).toBe(5);
    expect(r.lastHash.equals(rows[4]!.hash)).toBe(true);
  });

  it('cadeia vazia é ok', () => {
    const r = verifyChain([]);
    expect(r.ok).toBe(true);
    expect(r.rowsChecked).toBe(0);
    expect(r.lastNsr).toBe(0);
  });

  it('campo alterado no meio é corrupção', () => {
    const rows = makeChain(5);
    rows[2] = { ...rows[2]!, cpf: '99999999999' };
    const r = verifyChain(rows);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('NSR 3') && e.includes('recalculado'))).toBe(true);
  });

  it('NSR pulando é corrupção', () => {
    const rows = makeChain(4);
    rows.splice(2, 1); // 1,2,4
    const r = verifyChain(rows);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('esperado 3') && e.includes('encontrado 4'))).toBe(true);
  });

  it('hash_anterior quebrado é corrupção', () => {
    const rows = makeChain(3);
    rows[1] = { ...rows[1]!, hashAnterior: Buffer.alloc(32, 1) };
    const r = verifyChain(rows);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('hash_anterior'))).toBe(true);
  });

  it('microssegundos reais são corrupção', () => {
    const rows = makeChain(2);
    rows[1] = { ...rows[1]!, marcadoEm: '2026-11-20T12:00:02.100456Z' };
    const r = verifyChain(rows);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('marcado_em'))).toBe(true);
  });

  it('timestamp com menos de 3 casas é corrupção', () => {
    const rows = makeChain(1);
    rows[0] = { ...rows[0]!, gravadoEm: '2026-11-20T12:00:01.2Z' };
    expect(verifyChain(rows).ok).toBe(false);
  });

  it('gravado_em retrocedendo é só aviso', () => {
    const rows: ChainRow[] = [];
    let prev = GENESIS_HASH;
    const gravados = ['2026-11-20T12:00:05.000Z', '2026-11-20T12:00:01.000Z'];
    gravados.forEach((g, idx) => {
      const nsr = idx + 1;
      const m = '2026-11-20T12:00:00.000Z';
      const hash = computeRecordHash(
        { nsr, tipo: '7', marcadoEm: m, cpf: '12345678901', gravadoEm: g, tipoColetor: '01', ehOffline: false },
        prev,
      );
      rows.push({
        nsr, tipo: '7', cpf: '12345678901', tipoColetor: '01', ehOffline: false,
        marcadoEm: m, gravadoEm: g, hash, hashAnterior: prev, versaoFormatoHash: 1,
      });
      prev = hash;
    });
    const r = verifyChain(rows);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toHaveLength(1);
  });

  it('versão de formato desconhecida é corrupção', () => {
    const rows = makeChain(2);
    rows[1] = { ...rows[1]!, versaoFormatoHash: 2 };
    const r = verifyChain(rows);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('versao_formato_hash'))).toBe(true);
  });
});
