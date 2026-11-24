/** Regras puras da análise de atestado (G6): anonimização, CID, pré-checagens e notas. Dados fictícios. */
import { describe, expect, it } from 'vitest';
import { extractCidCandidates, interpretCid, normalizeCid } from './cid';
import { runPreChecks, type CertificateFacts } from './pre-checks';
import { containsPersonalData, redactPersonalData } from './redact';
import { reliability, riskScore } from './reliability';
import { extractTextFacts } from './text-facts';
import { RELIABILITY_CAP, RELIABILITY_CAP_WITHOUT_AI } from './weights';

const person = { cpf: '52998224725', name: 'Joana Prado Fictícia' };

describe('redactPersonalData: CPF e nome saem antes do envio (LGPD art. 11)', () => {
  it.each([
    ['CPF com máscara', 'CPF 529.982.247-25 da paciente', 'CPF [CPF] da paciente'],
    ['CPF só dígitos', 'documento 52998224725.', 'documento [CPF].'],
    ['outro CPF qualquer', 'acompanhante 111.444.777-35', 'acompanhante [CPF]'],
    ['nome completo', 'paciente Joana Prado Fictícia, atendida', 'paciente [NOME], atendida'],
    ['nome em maiúsculas sem acento', 'PACIENTE JOANA PRADO FICTICIA', 'PACIENTE [NOME]'],
    ['só o sobrenome', 'Sra. Prado compareceu', 'Sra. [NOME] compareceu'],
    ['não corta palavra maior', 'Pradolândia é a cidade', 'Pradolândia é a cidade'],
    ['data não é CPF', 'em 18/11/2026 às 10h', 'em 18/11/2026 às 10h'],
  ])('%s', (_label, input, expected) => {
    expect(redactPersonalData(input, person).text).toBe(expected);
  });

  it('conta o que saiu e a conferência final não acha mais nada', () => {
    const r = redactPersonalData('Joana Prado Fictícia, CPF 52998224725, e JOANA de novo', person);
    expect(r.removed.cpf).toBe(1);
    expect(r.removed.name).toBeGreaterThanOrEqual(2);
    expect(containsPersonalData(r.text, person)).toBe(false);
    expect(containsPersonalData('fala com a Joana', person)).toBe(true);
  });
});

describe('CID-10: extração e interpretação pelo capítulo', () => {
  it.each([
    ['J11.1', 'X'],
    ['A09', 'I'],
    ['F32', 'V'],
    ['H66', 'VIII'],
    ['S82.0', 'XIX'],
    ['T14', 'XIX'],
    ['Z76.3', 'XXI'],
    ['U07.1', 'XXII'],
  ])('%s → capítulo %s', (code, chapter) => {
    expect(interpretCid(code)).toMatchObject({ code, chapter, status: 'valido' });
  });

  it.each([['D49'], ['H97'], ['K95'], ['P97']])('%s está bem formado mas fora das faixas', (code) => {
    expect(interpretCid(code)).toMatchObject({ chapter: null, status: 'fora_da_tabela' });
  });

  it.each([
    ['j11.1', 'J11.1'],
    ['J 11.1', 'J11.1'],
    ['J111', 'J11.1'],
    ['J1', null],
    ['11.1', null],
  ])('normalizeCid(%s) = %s', (raw, expected) => {
    expect(normalizeCid(raw)).toBe(expected);
  });

  it('rótulo dá confiança alta; código com O no lugar de 0 vira hipótese; código solto é fraco', () => {
    expect(extractCidCandidates('CID-10: J11.1')[0]).toMatchObject({ code: 'J11.1', confidence: 0.9, source: 'regra' });
    expect(extractCidCandidates('CID: J1O')[0]).toMatchObject({ code: 'J10', confidence: 0.6 });
    const loose = extractCidCandidates('Hipótese J11, sem rótulo');
    expect(loose).toHaveLength(1);
    expect(loose[0]!.confidence).toBeLessThan(0.5);
    expect(extractCidCandidates('sem código nenhum')).toEqual([]);
  });
});

describe('extractTextFacts', () => {
  it('lê data de emissão, dias por número e extenso, intervalo e CRM', () => {
    const f = extractTextFacts('necessita de 3 (três) dias, de 18/11/2026 a 20/11/2026.\nDra. Helena Duarte\nCRM-SP 123456\nData: 18/11/2026');
    expect(f.issueDate?.date).toBe('2026-11-18');
    expect(f.days).toMatchObject({ value: 3, words: 3 });
    expect(f.range).toMatchObject({ start: '2026-11-18', end: '2026-11-20' });
    expect(f.doctor?.raw).toBe('Dra. Helena Duarte');
    expect(f.crm).toMatchObject({ number: '123456', uf: 'SP', wellFormed: true });
  });

  it('data por extenso no rodapé e data com O no lugar de 0', () => {
    expect(extractTextFacts('Texto.\nSão Paulo, 19 de novembro de 2026.').issueDate?.date).toBe('2026-11-19');
    const amb = extractTextFacts('Data: 1O/11/2026');
    expect(amb.issueDate).toBeNull();
    expect(amb.ambiguousDates[0]!.readings).toEqual(['2026-11-10', '2026-11-01']);
  });

  it('conta marcas de ilegibilidade', () => {
    expect(extractTextFacts('### ??? [ilegível] ███').illegibleMarks).toBe(4);
  });
});

describe('runPreChecks: regras antes da IA', () => {
  const cert: CertificateFacts = {
    id: 1,
    startDate: '2026-11-17',
    days: 2,
    hours: null,
    doctorCrm: null,
    doctorCrmUf: null,
    sentDate: '2026-11-17',
  };
  const facts = extractTextFacts('afastamento de 2 (dois) dias. Dr. Marcos Vieira CRM 54321/MG Data: 17/11/2026');
  const other = { id: 2, startDate: '2026-11-18', days: 1, hours: null, status: 'pendente', doctorCrm: null, doctorCrmUf: null };

  it.each([
    ['período sobreposto a atestado pendente', [other], true],
    ['período sobreposto a atestado aprovado', [{ ...other, status: 'aprovado' }], true],
    ['sobreposto, mas o outro foi recusado', [{ ...other, status: 'recusado' }], false],
    ['período sem sobreposição', [{ ...other, startDate: '2026-11-25' }], false],
    ['mesmo médico na mesma data', [{ ...other, startDate: '2026-11-17', days: null, hours: 2, doctorCrm: '54321', doctorCrmUf: 'MG' }], true],
  ])('%s → barra a IA: %s', (_label, others, blocks) => {
    const r = runPreChecks({
      certificate: { ...cert, doctorCrm: '54321', doctorCrmUf: 'MG' },
      others,
      text: facts,
      deadlineDays: null,
      removedPersonalData: 0,
    });
    expect(r.blocksAi).toBe(blocks);
    expect(r.findings.some((f) => f.code === 'atestado_duplicado')).toBe(blocks);
  });

  it('CRM, dias divergentes e prazo (com e sem parâmetro)', () => {
    const r = runPreChecks({
      certificate: { ...cert, days: 5, sentDate: '2026-11-30' },
      others: [],
      text: extractTextFacts('2 (dois) dias. Dr. Fulano Exemplo CRM 12A45'),
      deadlineDays: 2,
      removedPersonalData: 0,
    });
    expect(r.findings.map((f) => f.code).sort()).toEqual(['crm_invalido', 'datas_divergentes', 'enviado_fora_do_prazo']);
    expect(r.blocksAi).toBe(false);
    const noParam = runPreChecks({ certificate: cert, others: [], text: facts, deadlineDays: null, removedPersonalData: 0 });
    expect(noParam.skipped[0]).toMatch(/dias_prazo_atestado/);
  });
});

describe('risco e confiabilidade: nunca 100%', () => {
  it.each([
    [[], 0, 'baixo'],
    [['crm_invalido'], 20, 'baixo'],
    [['crm_invalido', 'datas_divergentes'], 45, 'medio'],
    [['atestado_duplicado'], 60, 'alto'],
    [['atestado_duplicado', 'datas_divergentes', 'crm_invalido'], 100, 'alto'],
  ] as const)('achados %j → nota %i, nível %s', (codes, score, level) => {
    const findings = codes.map((code) => ({ code, severity: 'media' as const, message: '' }));
    expect(riskScore(findings)).toEqual({ score, level });
  });

  it('teto de 90 mesmo sem nenhum problema; sem IA, teto de 50', () => {
    expect(reliability(0, ['ok', 'ok', 'ok', 'ok'])).toEqual({ score: RELIABILITY_CAP, band: 'alta', cap: RELIABILITY_CAP });
    expect(reliability(0, null)).toEqual({ score: RELIABILITY_CAP_WITHOUT_AI, band: 'media', cap: RELIABILITY_CAP_WITHOUT_AI });
    expect(reliability(20, ['ok', 'incoerente', 'ausente', 'ok'])).toMatchObject({ score: 45, band: 'media' });
    expect(reliability(100, ['ilegivel', 'ilegivel', 'ilegivel', 'ilegivel'])).toMatchObject({ score: 0, band: 'baixa' });
  });
});
