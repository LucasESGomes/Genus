-- Carga dos parâmetros legais padrão (conta NULL). Sem ela a apuração, a escala e as férias
-- falham em banco novo. Valores conforme as regras já testadas (RN02 a RN11); os marcados
-- [A CONFIRMAR] ainda não passaram pelo jurídico. Mudança de valor = nova vigência em outra
-- migration. Chave que já tem padrão global cadastrado não é tocada.
-- `banco_saldo_negativo_max_min` fica de fora: é limite de acordo, não de lei [A CONFIRMAR].
INSERT INTO rh.parametros_legais (chave, valor, base_legal, vigencia_inicio, vigencia_fim)
SELECT v.chave, v.valor::jsonb, v.base_legal, v.vigencia_inicio::date, v.vigencia_fim::date
  FROM (VALUES
    ('tolerancia_batida_min', '5', 'CLT art. 58 §1º', '2000-01-01', NULL),
    ('tolerancia_dia_min', '10', 'CLT art. 58 §1º; Súmula 366 TST', '2000-01-01', NULL),
    ('jornada_exige_intervalo_longo_acima_min', '360', 'CLT art. 71 caput', '2000-01-01', NULL),
    ('intervalo_longo_min', '60', 'CLT art. 71 caput', '2000-01-01', NULL),
    ('jornada_exige_intervalo_curto_acima_min', '240', 'CLT art. 71 §1º', '2000-01-01', NULL),
    ('intervalo_curto_min', '15', 'CLT art. 71 §1º', '2000-01-01', NULL),
    ('interjornada_min', '660', 'CLT art. 66', '2000-01-01', NULL),
    ('extras_diarias_max_min', '120', 'CLT art. 59', '2000-01-01', NULL),
    ('noturno_inicio', '"22:00"', 'CLT art. 73 §2º', '2000-01-01', NULL),
    ('noturno_fim', '"05:00"', 'CLT art. 73 §2º', '2000-01-01', NULL),
    ('hora_noturna_segundos', '3150', 'CLT art. 73 §1º', '2000-01-01', NULL),
    ('noturno_inicio_rural_lavoura', '"21:00"', 'Lei 5.889/1973 art. 7º [A CONFIRMAR]', '2000-01-01', NULL),
    ('noturno_fim_rural_lavoura', '"05:00"', 'Lei 5.889/1973 art. 7º [A CONFIRMAR]', '2000-01-01', NULL),
    ('hora_noturna_segundos_rural_lavoura', '3600', 'Rural sem hora reduzida [A CONFIRMAR]', '2000-01-01', NULL),
    ('noturno_inicio_rural_pecuaria', '"20:00"', 'Lei 5.889/1973 art. 7º [A CONFIRMAR]', '2000-01-01', NULL),
    ('noturno_fim_rural_pecuaria', '"04:00"', 'Lei 5.889/1973 art. 7º [A CONFIRMAR]', '2000-01-01', NULL),
    ('hora_noturna_segundos_rural_pecuaria', '3600', 'Rural sem hora reduzida [A CONFIRMAR]', '2000-01-01', NULL),
    ('jornada_semanal_max_min', '2640', 'CF art. 7º XIII (44 h)', '2000-01-01', '2026-12-15'),
    ('jornada_semanal_max_min', '2520', 'EC 141/2026 (42 h)', '2026-12-16', '2027-12-15'),
    ('jornada_semanal_max_min', '2400', 'EC 141/2026 (40 h)', '2027-12-16', NULL),
    ('folgas_semanais_min', '1', 'Lei 605/1949', '2000-01-01', '2026-12-15'),
    ('folgas_semanais_min', '2', 'EC 141/2026; 2027 em diante [A CONFIRMAR]', '2026-12-16', NULL),
    ('banco_prazo_meses_individual', '6', 'CLT art. 59 §5º', '2000-01-01', NULL),
    ('banco_prazo_meses_coletivo', '12', 'CLT art. 59 §2º', '2000-01-01', NULL),
    ('banco_desconto_saldo_negativo', 'false', 'Começa desligado; exige acordo [A CONFIRMAR]', '2000-01-01', NULL),
    ('ferias_faixas_faltas', '[{"maxFaltas":5,"dias":30},{"maxFaltas":14,"dias":24},{"maxFaltas":23,"dias":18},{"maxFaltas":32,"dias":12},{"maxFaltas":null,"dias":0}]', 'CLT art. 130', '2000-01-01', NULL),
    ('ferias_periodos_max', '3', 'CLT art. 134 §1º', '2000-01-01', NULL),
    ('ferias_periodo_min_dias', '5', 'CLT art. 134 §1º', '2000-01-01', NULL),
    ('ferias_periodo_longo_min_dias', '14', 'CLT art. 134 §1º', '2000-01-01', NULL),
    ('ferias_dias_vedados_antes_descanso', '2', 'CLT art. 134 §3º', '2000-01-01', NULL),
    ('ferias_aviso_previo_dias', '30', 'CLT art. 135', '2000-01-01', NULL),
    ('ferias_abono_fracao_divisor', '3', 'CLT art. 143', '2000-01-01', NULL)
  ) AS v(chave, valor, base_legal, vigencia_inicio, vigencia_fim)
 WHERE NOT EXISTS (
    SELECT 1 FROM rh.parametros_legais p WHERE p.conta_id IS NULL AND p.chave = v.chave
 );
