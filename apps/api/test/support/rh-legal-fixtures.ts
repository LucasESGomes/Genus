/**
 * Parâmetros de FIXTURE para as regras de RH. Não são o seed real: cada linha
 * diz de onde o número veio. Os testes que provam a parametrização trocam o
 * valor e conferem que o resultado muda.
 */
import type { LegalParameterRow } from '../../src/modules/legal-parameters/rules/resolve';

let seq = 0;

export function param(
  key: string,
  value: unknown,
  opts: { validFrom?: string; validTo?: string | null; companyId?: string | null; legalBasis?: string } = {},
): LegalParameterRow {
  seq += 1;
  return {
    id: `fx${seq}`,
    companyId: opts.companyId ?? null,
    key,
    value,
    legalBasis: opts.legalBasis ?? null,
    validFrom: opts.validFrom ?? '2000-01-01',
    validTo: opts.validTo ?? null,
  };
}

/** Apuração do dia (G4). */
export function timesheetParams(overrides: Record<string, unknown> = {}): LegalParameterRow[] {
  const base: Record<string, unknown> = {
    tolerancia_batida_min: 5, // RN02, CLT art. 58 §1º
    tolerancia_dia_min: 10, // RN02, CLT art. 58 §1º; Súmula 366 TST
    jornada_exige_intervalo_longo_acima_min: 360, // RN03, CLT art. 71 caput (acima de 6 h)
    intervalo_longo_min: 60, // RN03, CLT art. 71 caput (1 h)
    jornada_exige_intervalo_curto_acima_min: 240, // RN03, CLT art. 71 §1º (acima de 4 h)
    intervalo_curto_min: 15, // RN03, CLT art. 71 §1º (15 min)
    interjornada_min: 660, // RN04, CLT art. 66 (11 h)
    extras_diarias_max_min: 120, // RN05, CLT art. 59 (2 h)
    noturno_inicio: '22:00', // RN07, CLT art. 73 §2º
    noturno_fim: '05:00', // RN07, CLT art. 73 §2º
    hora_noturna_segundos: 3150, // RN07, CLT art. 73 §1º (52 min 30 s)
    noturno_inicio_rural_lavoura: '21:00', // RN07, Lei 5.889/1973 art. 7º [A CONFIRMAR]
    noturno_fim_rural_lavoura: '05:00', // RN07, Lei 5.889/1973 art. 7º [A CONFIRMAR]
    hora_noturna_segundos_rural_lavoura: 3600, // RN07: rural sem hora reduzida [A CONFIRMAR]
    noturno_inicio_rural_pecuaria: '20:00', // RN07, Lei 5.889/1973 art. 7º [A CONFIRMAR]
    noturno_fim_rural_pecuaria: '04:00', // RN07, Lei 5.889/1973 art. 7º [A CONFIRMAR]
    hora_noturna_segundos_rural_pecuaria: 3600, // RN07: rural sem hora reduzida [A CONFIRMAR]
    ...overrides,
  };
  return Object.entries(base).map(([k, v]) => param(k, v));
}

/** Jornada semanal (RN06, EC 141/2026, `04` G2). */
export function workweekParams(): LegalParameterRow[] {
  return [
    param('jornada_semanal_max_min', 2640, { validTo: '2026-12-15', legalBasis: 'CF art. 7º XIII (44 h)' }),
    param('jornada_semanal_max_min', 2520, { validFrom: '2026-12-16', validTo: '2027-12-15', legalBasis: 'EC 141/2026 (42 h)' }),
    param('jornada_semanal_max_min', 2400, { validFrom: '2027-12-16', legalBasis: 'EC 141/2026 (40 h)' }),
    param('folgas_semanais_min', 1, { validTo: '2026-12-15', legalBasis: 'Lei 605/1949' }),
    param('folgas_semanais_min', 2, { validFrom: '2026-12-16', legalBasis: 'EC 141/2026; 2027+ [A CONFIRMAR]' }),
  ];
}

/** Banco de horas (RN09, `04` G8). */
export function timeBankParams(overrides: Record<string, unknown> = {}): LegalParameterRow[] {
  const base: Record<string, unknown> = {
    banco_prazo_meses_individual: 6, // RN09, CLT art. 59 §5º
    banco_prazo_meses_coletivo: 12, // RN09, CLT art. 59 §2º
    banco_saldo_negativo_max_min: 600, // fixture: limite do acordo (não legal)
    banco_desconto_saldo_negativo: false, // `04` G8: começa desligado [A CONFIRMAR]
    ...overrides,
  };
  return Object.entries(base).map(([k, v]) => param(k, v));
}

/** Férias (RN10, RN11, `04` G9). */
export function vacationParams(overrides: Record<string, unknown> = {}): LegalParameterRow[] {
  const base: Record<string, unknown> = {
    // RN10, CLT art. 130
    ferias_faixas_faltas: [
      { maxFaltas: 5, dias: 30 },
      { maxFaltas: 14, dias: 24 },
      { maxFaltas: 23, dias: 18 },
      { maxFaltas: 32, dias: 12 },
      { maxFaltas: null, dias: 0 },
    ],
    ferias_periodos_max: 3, // RN11, CLT art. 134 §1º
    ferias_periodo_min_dias: 5, // RN11, CLT art. 134 §1º
    ferias_periodo_longo_min_dias: 14, // RN11, CLT art. 134 §1º
    ferias_dias_vedados_antes_descanso: 2, // RN11, CLT art. 134 §3º
    ferias_aviso_previo_dias: 30, // RN11, CLT art. 135
    ferias_abono_fracao_divisor: 3, // CLT art. 143 (1/3)
    ...overrides,
  };
  return Object.entries(base).map(([k, v]) => param(k, v));
}
