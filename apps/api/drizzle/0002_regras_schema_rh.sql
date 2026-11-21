-- Regras do schema-rh.sql que o Drizzle não declara: exclusion constraints, view,
-- funções e triggers, comentários e permissões do papel de runtime.
--
-- Ajustes em relação ao schema-rh.sql (o resto é igual):
--   1. Toda função leva `SET search_path = rh, public`. O `SET search_path` do
--      arquivo original só vale para a sessão que o executa; sem isto, um trigger
--      disparado por uma conexão com o search_path padrão não acharia as tabelas.
--   2. fn_bloqueia_periodo_fechado confere também o OLD: no original, um UPDATE
--      que movesse a linha de um período fechado para um aberto passava.
--   3. fn_ferias_inicio_valido só considera o feriado estadual/municipal do
--      estabelecimento do colaborador (no original, o feriado de qualquer
--      cidade bloqueava o início das férias).
--   4. auditoria também recusa TRUNCATE (RNF03).
--   5. Multi-tenant (CLAUDE.md): conta_id em toda tabela. param_sem_sobreposicao
--      e a view do saldo passam a separar por conta, e o feriado próprio de
--      outra conta não bloqueia o início das férias.

-- ============================================================================
-- Exclusion constraints (vigência sem sobreposição)
-- ============================================================================

-- um colaborador não pode ter dois vínculos valendo no mesmo dia
ALTER TABLE rh.colaborador_vinculo ADD CONSTRAINT vinculo_sem_sobreposicao EXCLUDE USING gist (
    colaborador_id WITH =,
    daterange(vigencia_inicio, vigencia_fim, '[]') WITH &&
);
--> statement-breakpoint

-- duas escalas valendo no mesmo dia tornariam a apuração ambígua
ALTER TABLE rh.colaborador_escala ADD CONSTRAINT colab_escala_sem_sobreposicao EXCLUDE USING gist (
    colaborador_id WITH =,
    daterange(vigencia_inicio, vigencia_fim, '[]') WITH &&
);
--> statement-breakpoint

-- COALESCE porque EXCLUDE ignora NULL: sem ele, dois padrões globais passariam
ALTER TABLE rh.parametro_legal ADD CONSTRAINT param_sem_sobreposicao EXCLUDE USING gist (
    (COALESCE(conta_id, 0)) WITH =,
    (COALESCE(empresa_id, 0)) WITH =,
    chave WITH =,
    daterange(vigencia_inicio, vigencia_fim, '[]') WITH &&
);
--> statement-breakpoint

-- ninguém fica afastado por dois motivos no mesmo dia
ALTER TABLE rh.afastamento ADD CONSTRAINT afast_sem_sobreposicao EXCLUDE USING gist (
    colaborador_id WITH =,
    daterange(data_inicio, data_fim, '[]') WITH &&
);
--> statement-breakpoint

ALTER TABLE rh.ferias_periodo_aquisitivo ADD CONSTRAINT pa_sem_sobreposicao EXCLUDE USING gist (
    colaborador_id WITH =,
    daterange(inicio, fim, '[]') WITH &&
);
--> statement-breakpoint

-- REGRA 1: a mesma pessoa nunca tem dois períodos de férias no mesmo dia.
-- Vale só para férias que de fato acontecem; recusada e cancelada não contam.
ALTER TABLE rh.ferias_gozo ADD CONSTRAINT fg_pessoa_sem_sobreposicao EXCLUDE USING gist (
    colaborador_id WITH =,
    daterange(data_inicio, data_fim, '[]') WITH &&
) WHERE (status IN ('aprovada','gozada'));
--> statement-breakpoint

-- ============================================================================
-- Comentários
-- ============================================================================

COMMENT ON COLUMN rh.setor.limite_ferias_simultaneas IS
  'Quantas pessoas do setor podem estar de férias ao mesmo tempo. '
  'Padrão 1: ninguém do mesmo setor sobrepõe. Ver trigger trg_ferias_limite_setor.';
--> statement-breakpoint

COMMENT ON TABLE rh.parametro_legal IS
  'Chaves: jornada_semanal_max_min, tolerancia_batida_min, tolerancia_dia_min, '
  'adicional_noturno_pct, noturno_inicio, noturno_fim, extra_pct_50, extra_pct_100, '
  'banco_prazo_meses, interjornada_min. A mudança de 44h para 42h (16/12/2026) e '
  'para 40h (16/12/2027) é uma linha nova aqui, não uma alteração de código.';
--> statement-breakpoint

COMMENT ON COLUMN rh.atestado.cid_cifrado IS
  'CID cifrado na aplicação (AES-GCM). Dado de saúde: só o RH lê (RN15) e toda leitura '
  'gera auditoria com acao = leitura_sensivel.';
--> statement-breakpoint

COMMENT ON COLUMN rh.atestado_analise.ocr_texto_cifrado IS
  'Texto do OCR cifrado na aplicação (AES-GCM). Mesmo tratamento do CID.';
--> statement-breakpoint

COMMENT ON COLUMN rh.atestado_analise.motivos IS
  'Lista das regras disparadas, ex.: ["nome_divergente","crm_invalido",'
  '"fora_do_prazo","recorrencia_segunda"]. Nenhuma recusa o atestado sozinha.';
--> statement-breakpoint

COMMENT ON COLUMN rh.ferias_gozo.setor_id IS
  'Setor vigente no momento da solicitação, copiado de colaborador_vinculo. '
  'Fica aqui porque o vínculo muda com o tempo e a regra do setor precisa saber '
  'qual setor ficaria desfalcado naquelas datas.';
--> statement-breakpoint

COMMENT ON TABLE rh.auditoria IS
  'Inclui a leitura de dado sensível (acao = leitura_sensivel), que é como a '
  'LGPD é atendida para CID e arquivo de atestado (RN15, RNF04).';
--> statement-breakpoint

-- ============================================================================
-- E. Banco de horas: saldo
-- ============================================================================

CREATE VIEW rh.vw_banco_horas_saldo AS
SELECT conta_id,
       colaborador_id,
       sum(minutos) AS saldo_minutos,
       sum(minutos) FILTER (
           WHERE minutos > 0
             AND data_vencimento IS NOT NULL
             AND data_vencimento <= current_date + 30
       ) AS minutos_vencendo_30d
  FROM rh.banco_horas_lancamento
 GROUP BY conta_id, colaborador_id;
--> statement-breakpoint

-- ============================================================================
-- F. Férias
-- ============================================================================

-- ----------------------------------------------------------------------------
-- REGRA 2: setor não fica desfalcado.
-- Exemplo: Lucas, João e Leandro são do setor Vendas, que tem limite 1.
-- Se Lucas tem férias aprovadas de 10/01 a 20/01, João não consegue aprovar
-- nenhum período que encoste nesse intervalo. Em um setor maior, basta subir
-- setor.limite_ferias_simultaneas.
--
-- É trigger e não EXCLUDE porque o limite é configurável. Com limite fixo em 1,
-- bastaria: EXCLUDE USING gist (setor_id WITH =, daterange(...) WITH &&).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rh.fn_ferias_limite_setor() RETURNS trigger
LANGUAGE plpgsql
SET search_path = rh, public
AS $$
DECLARE
    v_limite     smallint;
    v_em_ferias  integer;
    v_setor      text;
BEGIN
    IF NEW.status NOT IN ('aprovada','gozada') THEN
        RETURN NEW;
    END IF;

    -- FOR UPDATE serializa as aprovações do mesmo setor: sem isso, duas
    -- aprovações simultâneas leriam a mesma contagem e as duas passariam.
    SELECT limite_ferias_simultaneas, nome
      INTO v_limite, v_setor
      FROM setor
     WHERE id = NEW.setor_id
       FOR UPDATE;

    SELECT count(*)
      INTO v_em_ferias
      FROM ferias_gozo g
     WHERE g.setor_id = NEW.setor_id
       AND g.id IS DISTINCT FROM NEW.id
       AND g.status IN ('aprovada','gozada')
       AND daterange(g.data_inicio, g.data_fim, '[]')
        && daterange(NEW.data_inicio, NEW.data_fim, '[]');

    IF v_em_ferias >= v_limite THEN
        RAISE EXCEPTION
            'Setor % ficaria desfalcado: % pessoa(s) já de férias nesse intervalo, limite %',
            v_setor, v_em_ferias, v_limite
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER trg_ferias_limite_setor
    BEFORE INSERT OR UPDATE ON rh.ferias_gozo
    FOR EACH ROW EXECUTE FUNCTION rh.fn_ferias_limite_setor();
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- REGRA 3: fracionamento e saldo de dias (RN11, CLT arts. 134 e 135).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rh.fn_ferias_fracionamento() RETURNS trigger
LANGUAGE plpgsql
SET search_path = rh, public
AS $$
DECLARE
    v_dias        smallint;
    v_periodos    integer;
    v_dias_outros integer;
    v_tem_14      boolean;
    v_direito     smallint;
BEGIN
    IF NEW.status NOT IN ('aprovada','gozada') THEN
        RETURN NEW;
    END IF;

    -- NEW.dias ainda é NULL aqui: coluna STORED é calculada depois do BEFORE trigger
    v_dias := NEW.data_fim - NEW.data_inicio + 1;

    SELECT dias_direito INTO v_direito
      FROM ferias_periodo_aquisitivo
     WHERE id = NEW.periodo_aquisitivo_id
       FOR UPDATE;

    SELECT count(*), coalesce(sum(data_fim - data_inicio + 1), 0),
           coalesce(bool_or(data_fim - data_inicio + 1 >= 14), false)
      INTO v_periodos, v_dias_outros, v_tem_14
      FROM ferias_gozo
     WHERE periodo_aquisitivo_id = NEW.periodo_aquisitivo_id
       AND id IS DISTINCT FROM NEW.id
       AND status IN ('aprovada','gozada');

    IF v_periodos + 1 > 3 THEN
        RAISE EXCEPTION 'Férias em no máximo 3 períodos (CLT art. 134 §1º)'
            USING ERRCODE = 'check_violation';
    END IF;

    IF v_dias_outros + v_dias + NEW.abono_pecuniario_dias > v_direito THEN
        RAISE EXCEPTION
            'Dias solicitados (%) passam do direito do período aquisitivo (%)',
            v_dias_outros + v_dias + NEW.abono_pecuniario_dias, v_direito
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.abono_pecuniario_dias > v_direito / 3 THEN
        RAISE EXCEPTION 'Abono pecuniário limitado a 1/3 do direito (% dias)',
            v_direito / 3
            USING ERRCODE = 'check_violation';
    END IF;

    -- "um período com 14 dias ou mais" só pode ser cobrado quando o saldo acaba:
    -- cobrar antes impediria marcar 5 dias primeiro e 14 depois
    IF v_periodos + 1 > 1
       AND v_dias_outros + v_dias + NEW.abono_pecuniario_dias = v_direito
       AND NOT (v_tem_14 OR v_dias >= 14) THEN
        RAISE EXCEPTION 'Um dos períodos precisa ter 14 dias ou mais (CLT art. 134 §1º)'
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER trg_ferias_fracionamento
    BEFORE INSERT OR UPDATE ON rh.ferias_gozo
    FOR EACH ROW EXECUTE FUNCTION rh.fn_ferias_fracionamento();
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- REGRA 4: férias não começam em feriado, em descanso semanal, nem nos 2 dias
-- anteriores a um deles (CLT art. 134 §3º).
-- Simplificação: o descanso semanal é tratado como sábado e domingo. A versão
-- exata consulta escala_dia do colaborador; trocar quando a escala estiver pronta.
-- Ajuste: só contam o feriado nacional e os da UF e do município do
-- estabelecimento do colaborador; dos feriados próprios de conta, só os da conta dele.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rh.fn_ferias_inicio_valido() RETURNS trigger
LANGUAGE plpgsql
SET search_path = rh, public
AS $$
BEGIN
    IF NEW.status NOT IN ('aprovada','gozada') THEN
        RETURN NEW;
    END IF;

    IF EXISTS (
        SELECT 1
          FROM feriado f
          JOIN colaborador c     ON c.id = NEW.colaborador_id
          JOIN estabelecimento e ON e.id = c.estabelecimento_id
         WHERE NOT f.facultativo
           AND (f.conta_id IS NULL OR f.conta_id = NEW.conta_id)
           AND f.data BETWEEN NEW.data_inicio AND NEW.data_inicio + 2
           AND (f.abrangencia = 'nacional'
             OR (f.abrangencia = 'estadual'  AND f.uf = e.uf)
             OR (f.abrangencia = 'municipal' AND f.municipio_ibge = e.municipio_ibge))
    ) OR extract(isodow FROM NEW.data_inicio) IN (6,7)
      OR extract(isodow FROM NEW.data_inicio + 1) IN (6,7)
      OR extract(isodow FROM NEW.data_inicio + 2) IN (6,7)
    THEN
        RAISE EXCEPTION
            'Férias não podem começar em feriado ou descanso semanal, nem nos 2 dias anteriores (CLT art. 134 §3º)'
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER trg_ferias_inicio_valido
    BEFORE INSERT OR UPDATE ON rh.ferias_gozo
    FOR EACH ROW EXECUTE FUNCTION rh.fn_ferias_inicio_valido();
--> statement-breakpoint

-- ============================================================================
-- G. Fechamento e auditoria
-- ============================================================================

-- RNF03: auditoria é só de inserção
CREATE OR REPLACE FUNCTION rh.fn_auditoria_imutavel() RETURNS trigger
LANGUAGE plpgsql
SET search_path = rh, public
AS $$
BEGIN
    RAISE EXCEPTION 'Registro de auditoria não pode ser alterado nem removido (RNF03)'
        USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint

CREATE TRIGGER trg_auditoria_imutavel
    BEFORE UPDATE OR DELETE ON rh.auditoria
    FOR EACH ROW EXECUTE FUNCTION rh.fn_auditoria_imutavel();
--> statement-breakpoint

-- Ajuste: TRUNCATE não dispara trigger de linha; sem este, apagaria a auditoria inteira.
CREATE TRIGGER trg_auditoria_sem_truncate
    BEFORE TRUNCATE ON rh.auditoria
    FOR EACH STATEMENT EXECUTE FUNCTION rh.fn_auditoria_imutavel();
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- RF46: período fechado não aceita alteração. Reabrir primeiro (RF49).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rh.fn_periodo_fechado(p_colaborador bigint, p_data date) RETURNS boolean
LANGUAGE sql STABLE
SET search_path = rh, public
AS $$
    SELECT EXISTS (
        SELECT 1
          FROM fechamento f
          JOIN colaborador c ON c.estabelecimento_id = f.estabelecimento_id
         WHERE c.id = p_colaborador
           AND f.status = 'fechado'
           AND p_data BETWEEN f.data_inicio AND f.data_fim
    );
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION rh.fn_bloqueia_periodo_fechado() RETURNS trigger
LANGUAGE plpgsql
SET search_path = rh, public
AS $$
BEGIN
    -- Ajuste: confere a linha antiga também. Sem isso, um UPDATE que trocasse a
    -- data (ou o colaborador) tiraria a linha de um período fechado.
    IF TG_OP IN ('UPDATE','DELETE') AND fn_periodo_fechado(OLD.colaborador_id, OLD.data) THEN
        RAISE EXCEPTION 'Período fechado em % para esse colaborador: reabra antes de alterar (RF46)',
            OLD.data USING ERRCODE = 'check_violation';
    END IF;

    IF TG_OP IN ('INSERT','UPDATE') AND fn_periodo_fechado(NEW.colaborador_id, NEW.data) THEN
        RAISE EXCEPTION 'Período fechado em % para esse colaborador: reabra antes de alterar (RF46)',
            NEW.data USING ERRCODE = 'check_violation';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER trg_apuracao_periodo_fechado
    BEFORE INSERT OR UPDATE OR DELETE ON rh.apuracao_dia
    FOR EACH ROW EXECUTE FUNCTION rh.fn_bloqueia_periodo_fechado();
--> statement-breakpoint

CREATE TRIGGER trg_ajuste_periodo_fechado
    BEFORE INSERT OR UPDATE ON rh.ajuste
    FOR EACH ROW EXECUTE FUNCTION rh.fn_bloqueia_periodo_fechado();
--> statement-breakpoint

-- ============================================================================
-- Permissões do papel de runtime (rh_api, criado por infra/postgres-rh/init).
-- O dono (rh_owner) só roda migrations. rh_api lê e escreve, mas na auditoria
-- só insere e lê. Sem o papel (ex.: banco de teste), o bloco não faz nada.
-- ============================================================================
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rh_api') THEN
        GRANT USAGE ON SCHEMA rh TO rh_api;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA rh TO rh_api;
        GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA rh TO rh_api;
        REVOKE UPDATE, DELETE, TRUNCATE ON rh.auditoria FROM rh_api;
        -- Tabelas e sequências criadas por migrations futuras (como o dono) já nascem liberadas.
        ALTER DEFAULT PRIVILEGES IN SCHEMA rh GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO rh_api;
        ALTER DEFAULT PRIVILEGES IN SCHEMA rh GRANT USAGE, SELECT ON SEQUENCES TO rh_api;
    END IF;
END;
$$;
