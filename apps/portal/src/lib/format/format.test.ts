import { describe, expect, it } from 'vitest';
import { fixedClock } from '../clock';
import {
  addCivilDays, addMonths, describeMinutes, formatCpf, formatDate, formatInstant, formatMinutes, formatMonth, formatPeriod, formatTime, initials,
  monthRange, todayCivil, weekdayShort,
} from './index';

describe('formatação', () => {
  it.each([
    [0, '00:00'], [5, '00:05'], [545, '09:05'], [-150, '-02:30'], [1500, '25:00'],
  ])('minutos %i → %s', (m, s) => expect(formatMinutes(m)).toBe(s));
  it('com sinal', () => {
    expect(formatMinutes(30, { signed: true })).toBe('+00:30');
    expect(formatMinutes(0, { signed: true })).toBe('00:00');
  });
  it('minutos por extenso para leitor de tela', () => {
    expect(describeMinutes(545)).toBe('9 horas e 5 minutos');
    expect(describeMinutes(60)).toBe('1 hora');
    expect(describeMinutes(0)).toBe('0 minutos');
    expect(describeMinutes(-30)).toBe('menos 30 minutos');
  });
  it('data civil não muda de dia por fuso', () => {
    expect(formatDate('2026-11-21')).toBe('21/11/2026');
    expect(formatDate('2026-11-21', 'long')).toBe('21 de novembro de 2026');
    expect(weekdayShort('2026-11-21')).toBe('Sáb');
  });
  it('instante no fuso do estabelecimento', () => {
    expect(formatTime('2026-11-21T10:02:00.000Z')).toBe('07:02');
    expect(formatInstant('2026-11-21T10:02:00.000Z', 'America/Sao_Paulo')).toBe('21/11/2026 às 07:02');
  });
  it('"hoje" vem do relógio injetado, no fuso', () => {
    expect(todayCivil(fixedClock('2026-11-22T02:30:00.000Z'))).toBe('2026-11-21');
  });
  it('navegação de calendário', () => {
    expect(addCivilDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addCivilDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(formatMonth('2026-11')).toBe('novembro de 2026');
    expect(formatPeriod('2026-11-01', '2026-11-21')).toBe('1 a 21 de novembro de 2026');
  });
  it('CPF: formata 11 dígitos e mantém o mascarado da api', () => {
    expect(formatCpf('12345678901')).toBe('123.456.789-01');
    expect(formatCpf('***.***.***-01')).toBe('***.***.***-01');
  });
  it('iniciais', () => expect(initials('Lúcia Martins de Souza')).toBe('LS'));
});
