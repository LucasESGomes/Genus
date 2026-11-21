-- ============================================================================
-- Schema do módulo de RH — PostgreSQL
-- Banco: app (o banco arp, fiscal, não é tocado por este schema)
--
-- Referências: RF/RN da especificação de RH.
-- Tabelas marcadas [JÁ PODE EXISTIR] devem ser conferidas no banco antes de
-- criar: o lado do ponto já mantém cadastros e usuários no banco app.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;   -- EXCLUDE com coluna escalar + intervalo
CREATE EXTENSION IF NOT EXISTS citext;       -- e-mail sem diferenciar maiúsculas

CREATE SCHEMA IF NOT EXISTS rh;
SET search_path = rh, public;


-- ============================================================================
-- A. ORGANIZAÇÃO E PESSOAS
-- ============================================================================

CREATE TABLE empresa (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    razao_social    text        NOT NULL,
    cnpj            char(14)    NOT NULL UNIQUE,
    ativo           boolean     NOT NULL DEFAULT true,
    criado_em       timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT empresa_cnpj_formato CHECK (cnpj ~ '^[0-9]{14}$')
);

-- [JÁ PODE EXISTIR] RF01
CREATE TABLE estabelecimento (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    empresa_id       bigint   NOT NULL REFERENCES empresa(id),
    nome             text     NOT NULL,
    tipo_inscricao   text     NOT NULL,
    inscricao        text     NOT NULL,
    uf               char(2)  NOT NULL,
    municipio_ibge   char(7)  NOT NULL,   -- define os feriados municipais
    ativo            boolean  NOT NULL DEFAULT true,

    CONSTRAINT estab_tipo_inscricao  CHECK (tipo_inscricao IN ('CNPJ','CPF','CAEPF')),
    CONSTRAINT estab_uf_formato      CHECK (uf ~ '^[A-Z]{2}$'),
    CONSTRAINT estab_ibge_formato    CHECK (municipio_ibge ~ '^[0-9]{7}$'),
    CONSTRAINT estab_inscricao_unica UNIQUE (empresa_id, inscricao)
);

-- RF02 — guarda o limite de férias simultâneas (regra do setor desfalcado)
CREATE TABLE setor (
    id                         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    estabelecimento_id         bigint   NOT NULL REFERENCES estabelecimento(id),
    nome                       text     NOT NULL,
    limite_ferias_simultaneas  smallint NOT NULL DEFAULT 1,

    CONSTRAINT setor_limite_positivo CHECK (limite_ferias_simultaneas >= 1),
    CONSTRAINT setor_nome_unico      UNIQUE (estabelecimento_id, nome)
);

COMMENT ON COLUMN setor.limite_ferias_simultaneas IS
  'Quantas pessoas do setor podem estar de férias ao mesmo tempo. '
  'Padrão 1: ninguém do mesmo setor sobrepõe. Ver trigger trg_ferias_limite_setor.';

-- RF02
CREATE TABLE cargo (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    empresa_id  bigint   NOT NULL REFERENCES empresa(id),
    nome        text     NOT NULL,
    cbo         char(6),

    CONSTRAINT cargo_cbo_formato CHECK (cbo IS NULL OR cbo ~ '^[0-9]{6}$'),
    CONSTRAINT cargo_nome_unico  UNIQUE (empresa_id, nome)
);

-- RF02
CREATE TABLE centro_custo (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    empresa_id  bigint NOT NULL REFERENCES empresa(id),
    codigo      text   NOT NULL,
    nome        text   NOT NULL,

    CONSTRAINT cc_codigo_unico UNIQUE (empresa_id, codigo)
);

-- [JÁ PODE EXISTIR] RF03, RF05
CREATE TABLE colaborador (
    id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    estabelecimento_id   bigint   NOT NULL REFERENCES estabelecimento(id),
    cpf                  char(11) NOT NULL UNIQUE,
    nome                 text     NOT NULL,
    matricula            text,
    data_nascimento      date     NOT NULL,
    data_admissao        date     NOT NULL,
    data_desligamento    date,
    motivo_desligamento  text,
    gestor_id            bigint   REFERENCES colaborador(id),

    CONSTRAINT colab_cpf_formato     CHECK (cpf ~ '^[0-9]{11}$'),
    CONSTRAINT colab_admissao_valida CHECK (data_admissao > data_nascimento),
    CONSTRAINT colab_desligamento    CHECK (data_desligamento IS NULL
                                            OR data_desligamento >= data_admissao),
    -- desligamento sempre com motivo, e motivo só com desligamento
    CONSTRAINT colab_motivo_par      CHECK ((data_desligamento IS NULL)
                                            = (motivo_desligamento IS NULL)),
    CONSTRAINT colab_nao_gestor_si   CHECK (gestor_id IS DISTINCT FROM id),
    CONSTRAINT colab_matricula_unica UNIQUE (estabelecimento_id, matricula)
);

-- RF06 — histórico de cargo, setor, centro de custo e salário
CREATE TABLE colaborador_vinculo (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    colaborador_id   bigint        NOT NULL REFERENCES colaborador(id),
    cargo_id         bigint        NOT NULL REFERENCES cargo(id),
    setor_id         bigint        NOT NULL REFERENCES setor(id),
    centro_custo_id  bigint        REFERENCES centro_custo(id),
    tipo_contrato    text          NOT NULL,
    salario_base     numeric(12,2),           -- (a confirmar com o contador)
    vigencia_inicio  date          NOT NULL,
    vigencia_fim     date,

    CONSTRAINT vinculo_tipo_contrato CHECK (tipo_contrato IN
        ('indeterminado','determinado','safra','intermitente')),
    CONSTRAINT vinculo_salario_pos   CHECK (salario_base IS NULL OR salario_base > 0),
    CONSTRAINT vinculo_vigencia      CHECK (vigencia_fim IS NULL
                                            OR vigencia_fim >= vigencia_inicio),
    -- um colaborador não pode ter dois vínculos valendo no mesmo dia
    CONSTRAINT vinculo_sem_sobreposicao EXCLUDE USING gist (
        colaborador_id WITH =,
        daterange(vigencia_inicio, vigencia_fim, '[]') WITH &&
    )
);

-- [JÁ PODE EXISTIR] perfis de acesso
CREATE TABLE usuario (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    colaborador_id  bigint  UNIQUE REFERENCES colaborador(id),
    email           citext  NOT NULL UNIQUE,
    senha_hash      text    NOT NULL,
    papel           text    NOT NULL,
    mfa_ativo       boolean NOT NULL DEFAULT false,
    ativo           boolean NOT NULL DEFAULT true,

    CONSTRAINT usuario_papel CHECK (papel IN
        ('admin','rh','gestor','contador','funcionario','super_admin')),
    -- funcionário é sempre uma pessoa cadastrada; admin e contador podem ser externos
    CONSTRAINT usuario_funcionario_tem_colaborador
        CHECK (papel <> 'funcionario' OR colaborador_id IS NOT NULL),
    -- super admin da plataforma só existe com 2FA
    CONSTRAINT usuario_super_admin_mfa
        CHECK (papel <> 'super_admin' OR mfa_ativo)
);

-- RNF02 — escopo por estabelecimento
CREATE TABLE usuario_estabelecimento (
    usuario_id          bigint NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
    estabelecimento_id  bigint NOT NULL REFERENCES estabelecimento(id),
    PRIMARY KEY (usuario_id, estabelecimento_id)
);


-- ============================================================================
-- B. JORNADA: ESCALA, FERIADO E PARÂMETROS LEGAIS
-- ============================================================================

-- RF07, RF08
CREATE TABLE escala (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    estabelecimento_id  bigint   NOT NULL REFERENCES estabelecimento(id),
    nome                text     NOT NULL,
    tipo                text     NOT NULL,
    ciclo_tipo          text     NOT NULL,
    ciclo_dias          smallint,          -- só para ciclo 'ciclico' (12x36 = 2)
    data_referencia     date,              -- âncora do ciclo
    carga_semanal_min   integer  NOT NULL,

    CONSTRAINT escala_tipo       CHECK (tipo IN ('5x2','6x1','12x36','livre')),
    CONSTRAINT escala_ciclo_tipo CHECK (ciclo_tipo IN ('semanal','ciclico')),
    CONSTRAINT escala_carga_pos  CHECK (carga_semanal_min > 0),
    CONSTRAINT escala_ciclo_dias CHECK (ciclo_dias IS NULL
                                        OR ciclo_dias BETWEEN 2 AND 60),
    -- escala semanal usa dia da semana; escala cíclica precisa de tamanho e âncora
    CONSTRAINT escala_ciclo_coerente CHECK (
        (ciclo_tipo = 'semanal' AND ciclo_dias IS NULL AND data_referencia IS NULL)
     OR (ciclo_tipo = 'ciclico' AND ciclo_dias IS NOT NULL AND data_referencia IS NOT NULL)
    )
);

CREATE TABLE escala_dia (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    escala_id         bigint   NOT NULL REFERENCES escala(id) ON DELETE CASCADE,
    posicao           smallint NOT NULL,   -- 0-6 = dia da semana; 0..n = posição do ciclo
    folga             boolean  NOT NULL DEFAULT false,
    entrada           time,
    saida             time,
    intervalo_inicio  time,
    intervalo_fim     time,
    vira_dia          boolean  NOT NULL DEFAULT false,  -- saída no dia seguinte

    CONSTRAINT escala_dia_unico   UNIQUE (escala_id, posicao),
    CONSTRAINT escala_dia_posicao CHECK (posicao >= 0),
    -- folga não tem horário; dia trabalhado tem entrada e saída
    CONSTRAINT escala_dia_horario CHECK (
        (folga     AND entrada IS NULL     AND saida IS NULL)
     OR (NOT folga AND entrada IS NOT NULL AND saida IS NOT NULL)
    ),
    CONSTRAINT escala_dia_intervalo CHECK (
        (intervalo_inicio IS NULL AND intervalo_fim IS NULL)
     OR (intervalo_inicio IS NOT NULL AND intervalo_fim IS NOT NULL
         AND intervalo_inicio < intervalo_fim)
    )
);

-- RF09
CREATE TABLE colaborador_escala (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    colaborador_id   bigint NOT NULL REFERENCES colaborador(id),
    escala_id        bigint NOT NULL REFERENCES escala(id),
    vigencia_inicio  date   NOT NULL,
    vigencia_fim     date,

    CONSTRAINT colab_escala_vigencia CHECK (vigencia_fim IS NULL
                                            OR vigencia_fim >= vigencia_inicio),
    -- duas escalas valendo no mesmo dia tornariam a apuração ambígua
    CONSTRAINT colab_escala_sem_sobreposicao EXCLUDE USING gist (
        colaborador_id WITH =,
        daterange(vigencia_inicio, vigencia_fim, '[]') WITH &&
    )
);

-- RF12 — troca pontual de turno ou folga em um dia
CREATE TABLE troca_turno (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    colaborador_id  bigint      NOT NULL REFERENCES colaborador(id),
    data            date        NOT NULL,
    folga           boolean     NOT NULL DEFAULT false,
    entrada         time,
    saida           time,
    motivo          text        NOT NULL,
    criado_por      bigint      NOT NULL REFERENCES usuario(id),
    criado_em       timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT troca_unica   UNIQUE (colaborador_id, data),
    CONSTRAINT troca_horario CHECK (
        (folga     AND entrada IS NULL     AND saida IS NULL)
     OR (NOT folga AND entrada IS NOT NULL AND saida IS NOT NULL)
    )
);

-- RF14, RF15
CREATE TABLE feriado (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    abrangencia     text    NOT NULL,
    uf              char(2),
    municipio_ibge  char(7),
    data            date    NOT NULL,
    nome            text    NOT NULL,
    facultativo     boolean NOT NULL DEFAULT false,

    CONSTRAINT feriado_abrangencia CHECK (abrangencia IN
        ('nacional','estadual','municipal')),
    -- feriado nacional não tem UF; municipal exige UF e município
    CONSTRAINT feriado_escopo CHECK (
        (abrangencia = 'nacional'  AND uf IS NULL     AND municipio_ibge IS NULL)
     OR (abrangencia = 'estadual'  AND uf IS NOT NULL AND municipio_ibge IS NULL)
     OR (abrangencia = 'municipal' AND uf IS NOT NULL AND municipio_ibge IS NOT NULL)
    ),
    CONSTRAINT feriado_unico UNIQUE NULLS NOT DISTINCT
        (data, abrangencia, uf, municipio_ibge)   -- exige PostgreSQL 15+
);

-- RF16 — o estabelecimento trabalha no feriado? como trata a hora?
CREATE TABLE estabelecimento_feriado (
    estabelecimento_id  bigint NOT NULL REFERENCES estabelecimento(id),
    feriado_id          bigint NOT NULL REFERENCES feriado(id),
    trabalha            boolean NOT NULL DEFAULT false,
    tratamento          text,

    PRIMARY KEY (estabelecimento_id, feriado_id),
    CONSTRAINT estab_fer_tratamento CHECK (tratamento IS NULL
                                           OR tratamento IN ('pagar_100','banco_horas')),
    CONSTRAINT estab_fer_coerente CHECK (
        (NOT trabalha AND tratamento IS NULL)
     OR (trabalha     AND tratamento IS NOT NULL)
    )
);

-- RF10, RN06, RNF06 — nenhum valor legal fica fixo no código
CREATE TABLE parametro_legal (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    empresa_id       bigint,                  -- NULL = valor legal padrão
    chave            text    NOT NULL,
    valor            jsonb   NOT NULL,
    base_legal       text,
    vigencia_inicio  date    NOT NULL,
    vigencia_fim     date,

    CONSTRAINT param_empresa_fk FOREIGN KEY (empresa_id) REFERENCES empresa(id),
    CONSTRAINT param_vigencia   CHECK (vigencia_fim IS NULL
                                       OR vigencia_fim >= vigencia_inicio),
    -- COALESCE porque EXCLUDE ignora NULL: sem ele, dois padrões globais passariam
    CONSTRAINT param_sem_sobreposicao EXCLUDE USING gist (
        (COALESCE(empresa_id, 0)) WITH =,
        chave WITH =,
        daterange(vigencia_inicio, vigencia_fim, '[]') WITH &&
    )
);

COMMENT ON TABLE parametro_legal IS
  'Chaves: jornada_semanal_max_min, tolerancia_batida_min, tolerancia_dia_min, '
  'adicional_noturno_pct, noturno_inicio, noturno_fim, extra_pct_50, extra_pct_100, '
  'banco_prazo_meses, interjornada_min. A mudança de 44h para 42h (16/12/2026) e '
  'para 40h (16/12/2027) é uma linha nova aqui, não uma alteração de código.';


-- ============================================================================
-- C. APURAÇÃO
-- ============================================================================

-- RF18 a RF22 — resultado do dia já calculado
CREATE TABLE apuracao_dia (
    id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    colaborador_id        bigint      NOT NULL REFERENCES colaborador(id),
    data                  date        NOT NULL,
    escala_id             bigint      REFERENCES escala(id),
    situacao              text        NOT NULL,
    minutos_previstos     integer     NOT NULL DEFAULT 0,
    minutos_trabalhados   integer     NOT NULL DEFAULT 0,
    minutos_falta         integer     NOT NULL DEFAULT 0,
    minutos_atraso        integer     NOT NULL DEFAULT 0,
    minutos_extra_50      integer     NOT NULL DEFAULT 0,
    minutos_extra_100     integer     NOT NULL DEFAULT 0,
    minutos_noturno       integer     NOT NULL DEFAULT 0,
    minutos_intervalo     integer     NOT NULL DEFAULT 0,
    dsr_descontado        boolean     NOT NULL DEFAULT false,
    parametro_versao      text        NOT NULL,   -- RNF06: qual regra gerou o número
    calculado_em          timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT apuracao_dia_unico UNIQUE (colaborador_id, data),
    CONSTRAINT apuracao_situacao  CHECK (situacao IN
        ('normal','falta','folga','feriado','ferias','afastamento')),
    CONSTRAINT apuracao_minutos_nao_negativos CHECK (
        minutos_previstos   >= 0 AND minutos_trabalhados >= 0
    AND minutos_falta       >= 0 AND minutos_atraso      >= 0
    AND minutos_extra_50    >= 0 AND minutos_extra_100   >= 0
    AND minutos_noturno     >= 0 AND minutos_intervalo   >= 0),
    CONSTRAINT apuracao_noturno_cabe CHECK (minutos_noturno <= minutos_trabalhados)
);

-- As batidas originais vivem no banco arp e não são copiadas nem alteradas (RN01).
-- Aqui fica a visão resolvida do dia: original + tratada.
CREATE TABLE apuracao_marcacao (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    apuracao_dia_id   bigint      NOT NULL REFERENCES apuracao_dia(id) ON DELETE CASCADE,
    sequencia         smallint    NOT NULL,
    hora              timestamptz NOT NULL,
    origem            text        NOT NULL,
    nsr               bigint,       -- referência lógica ao banco arp: sem FK entre bancos
    ajuste_id         bigint,       -- FK criada depois, ajuste é declarado abaixo

    CONSTRAINT marcacao_unica    UNIQUE (apuracao_dia_id, sequencia),
    CONSTRAINT marcacao_origem   CHECK (origem IN ('original','tratada')),
    CONSTRAINT marcacao_sequencia CHECK (sequencia > 0),
    -- batida original vem do REP com NSR; marcação tratada vem de um ajuste aprovado
    CONSTRAINT marcacao_procedencia CHECK (
        (origem = 'original' AND nsr IS NOT NULL AND ajuste_id IS NULL)
     OR (origem = 'tratada'  AND nsr IS NULL     AND ajuste_id IS NOT NULL)
    )
);

-- RF21
CREATE TABLE inconsistencia (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    apuracao_dia_id  bigint  NOT NULL REFERENCES apuracao_dia(id) ON DELETE CASCADE,
    tipo             text    NOT NULL,
    resolvida        boolean NOT NULL DEFAULT false,
    resolvida_por    bigint  REFERENCES usuario(id),
    resolvida_em     timestamptz,

    CONSTRAINT inconsistencia_unica UNIQUE (apuracao_dia_id, tipo),
    CONSTRAINT inconsistencia_tipo  CHECK (tipo IN (
        'batida_faltando','batidas_impares','interjornada_menor_11h',
        'extra_acima_2h','intervalo_nao_cumprido')),
    CONSTRAINT inconsistencia_resolucao CHECK (
        (NOT resolvida AND resolvida_por IS NULL     AND resolvida_em IS NULL)
     OR (resolvida     AND resolvida_por IS NOT NULL AND resolvida_em IS NOT NULL)
    )
);


-- ============================================================================
-- D. AUSÊNCIAS: AJUSTE, ATESTADO, AFASTAMENTO
-- ============================================================================

-- RF23 a RF26
CREATE TABLE ajuste (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    colaborador_id  bigint      NOT NULL REFERENCES colaborador(id),
    data            date        NOT NULL,
    tipo            text        NOT NULL,
    hora_proposta   timestamptz,
    motivo          text        NOT NULL,
    anexo_url       text,
    status          text        NOT NULL DEFAULT 'pendente',
    solicitado_por  bigint      NOT NULL REFERENCES usuario(id),
    solicitado_em   timestamptz NOT NULL DEFAULT now(),
    decidido_por    bigint      REFERENCES usuario(id),
    decidido_em     timestamptz,
    motivo_decisao  text,

    CONSTRAINT ajuste_tipo   CHECK (tipo IN ('inclusao_batida','justificativa','abono')),
    CONSTRAINT ajuste_status CHECK (status IN ('pendente','aprovado','recusado')),
    CONSTRAINT ajuste_hora_obrigatoria
        CHECK (tipo <> 'inclusao_batida' OR hora_proposta IS NOT NULL),
    CONSTRAINT ajuste_decisao_coerente CHECK (
        (status =  'pendente' AND decidido_por IS NULL     AND decidido_em IS NULL)
     OR (status <> 'pendente' AND decidido_por IS NOT NULL AND decidido_em IS NOT NULL)
    ),
    CONSTRAINT ajuste_recusa_com_motivo
        CHECK (status <> 'recusado' OR motivo_decisao IS NOT NULL),
    -- quem pede não aprova o próprio pedido
    CONSTRAINT ajuste_decisor_diferente
        CHECK (decidido_por IS NULL OR decidido_por <> solicitado_por)
);

ALTER TABLE apuracao_marcacao
    ADD CONSTRAINT marcacao_ajuste_fk FOREIGN KEY (ajuste_id) REFERENCES ajuste(id);

-- RF27, RF28, RF32
CREATE TABLE atestado (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    colaborador_id  bigint      NOT NULL REFERENCES colaborador(id),
    data_inicio     date        NOT NULL,
    dias            smallint,
    horas           smallint,
    arquivo_url     text        NOT NULL,
    arquivo_hash    char(64)    NOT NULL,    -- SHA-256: detecta reenvio do mesmo arquivo
    medico_nome     text,
    medico_crm      text,
    medico_crm_uf   char(2),
    cid             text,                    -- dado sensível: só RH lê (RN15)
    status          text        NOT NULL DEFAULT 'pendente',
    enviado_em      timestamptz NOT NULL DEFAULT now(),
    decidido_por    bigint      REFERENCES usuario(id),
    decidido_em     timestamptz,
    motivo_decisao  text,

    CONSTRAINT atestado_status  CHECK (status IN ('pendente','aprovado','recusado')),
    -- o atestado afasta por dias ou por horas, nunca pelos dois
    CONSTRAINT atestado_duracao CHECK (num_nonnulls(dias, horas) = 1),
    CONSTRAINT atestado_dias_pos  CHECK (dias  IS NULL OR dias  > 0),
    CONSTRAINT atestado_horas_pos CHECK (horas IS NULL OR horas > 0),
    CONSTRAINT atestado_crm_uf    CHECK (medico_crm_uf IS NULL
                                         OR medico_crm_uf ~ '^[A-Z]{2}$'),
    CONSTRAINT atestado_arquivo_unico UNIQUE (colaborador_id, arquivo_hash),  -- RF64
    CONSTRAINT atestado_decisao_coerente CHECK (
        (status =  'pendente' AND decidido_por IS NULL     AND decidido_em IS NULL)
     OR (status <> 'pendente' AND decidido_por IS NOT NULL AND decidido_em IS NOT NULL)
    ),
    CONSTRAINT atestado_recusa_com_motivo
        CHECK (status <> 'recusado' OR motivo_decisao IS NOT NULL)
);

-- RF61 a RF67 — a heurística só sinaliza; quem decide é o RH
CREATE TABLE atestado_analise (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    atestado_id   bigint      NOT NULL UNIQUE REFERENCES atestado(id) ON DELETE CASCADE,
    ocr_texto     text,
    score         smallint    NOT NULL,
    nota_risco    text        NOT NULL,
    motivos       jsonb       NOT NULL DEFAULT '[]'::jsonb,
    analisado_em  timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT analise_nota    CHECK (nota_risco IN ('baixo','medio','alto')),
    CONSTRAINT analise_score   CHECK (score BETWEEN 0 AND 100),
    CONSTRAINT analise_motivos CHECK (jsonb_typeof(motivos) = 'array')
);

COMMENT ON COLUMN atestado_analise.motivos IS
  'Lista das regras disparadas, ex.: ["nome_divergente","crm_invalido",'
  '"fora_do_prazo","recorrencia_segunda"]. Nenhuma recusa o atestado sozinha.';

-- RF29, RF30, RF31
CREATE TABLE afastamento (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    colaborador_id  bigint NOT NULL REFERENCES colaborador(id),
    tipo            text   NOT NULL,
    data_inicio     date   NOT NULL,
    data_fim        date   NOT NULL,
    atestado_id     bigint UNIQUE REFERENCES atestado(id),

    CONSTRAINT afast_tipo CHECK (tipo IN (
        'atestado','maternidade','paternidade','casamento','obito',
        'doacao_sangue','alistamento','inss','outro')),
    CONSTRAINT afast_periodo CHECK (data_fim >= data_inicio),
    CONSTRAINT afast_atestado_coerente CHECK (
        (tipo =  'atestado' AND atestado_id IS NOT NULL)
     OR (tipo <> 'atestado' AND atestado_id IS NULL)
    ),
    -- ninguém fica afastado por dois motivos no mesmo dia
    CONSTRAINT afast_sem_sobreposicao EXCLUDE USING gist (
        colaborador_id WITH =,
        daterange(data_inicio, data_fim, '[]') WITH &&
    )
);


-- ============================================================================
-- E. BANCO DE HORAS
-- ============================================================================

-- RF34, RN09
CREATE TABLE banco_horas_regra (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    estabelecimento_id  bigint        REFERENCES estabelecimento(id),
    colaborador_id      bigint        REFERENCES colaborador(id),
    modalidade          text          NOT NULL,
    peso_domingo        numeric(3,2)  NOT NULL DEFAULT 1.00,
    peso_feriado        numeric(3,2)  NOT NULL DEFAULT 1.00,
    vigencia_inicio     date          NOT NULL,
    vigencia_fim        date,

    CONSTRAINT bh_regra_modalidade CHECK (modalidade IN ('individual_6m','coletivo_12m')),
    CONSTRAINT bh_regra_pesos      CHECK (peso_domingo >= 1 AND peso_feriado >= 1),
    -- a regra vale para um estabelecimento ou para uma pessoa, nunca para os dois
    CONSTRAINT bh_regra_escopo
        CHECK (num_nonnulls(estabelecimento_id, colaborador_id) = 1),
    CONSTRAINT bh_regra_vigencia CHECK (vigencia_fim IS NULL
                                        OR vigencia_fim >= vigencia_inicio)
);

-- RF33, RF35 a RF38 — o saldo é a soma dos lançamentos, nunca um campo editável
CREATE TABLE banco_horas_lancamento (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    colaborador_id    bigint      NOT NULL REFERENCES colaborador(id),
    apuracao_dia_id   bigint      REFERENCES apuracao_dia(id),
    tipo              text        NOT NULL,
    minutos           integer     NOT NULL,   -- positivo credita, negativo debita
    data_competencia  date        NOT NULL,
    data_vencimento   date,
    criado_por        bigint      NOT NULL REFERENCES usuario(id),
    criado_em         timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT bh_tipo CHECK (tipo IN
        ('credito','debito','folga_compensatoria','pagamento','desconto','expiracao')),
    CONSTRAINT bh_minutos_nao_zero CHECK (minutos <> 0),
    -- crédito soma, todo o resto subtrai
    CONSTRAINT bh_sinal_coerente CHECK (
        (tipo =  'credito' AND minutos > 0)
     OR (tipo <> 'credito' AND minutos < 0)
    ),
    CONSTRAINT bh_vencimento CHECK (data_vencimento IS NULL
                                    OR data_vencimento > data_competencia)
);

CREATE VIEW vw_banco_horas_saldo AS
SELECT colaborador_id,
       sum(minutos) AS saldo_minutos,
       sum(minutos) FILTER (
           WHERE minutos > 0
             AND data_vencimento IS NOT NULL
             AND data_vencimento <= current_date + 30
       ) AS minutos_vencendo_30d
  FROM banco_horas_lancamento
 GROUP BY colaborador_id;


-- ============================================================================
-- F. FÉRIAS
-- ============================================================================

-- RF39, RF40, RN10
CREATE TABLE ferias_periodo_aquisitivo (
    id                     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    colaborador_id         bigint   NOT NULL REFERENCES colaborador(id),
    inicio                 date     NOT NULL,
    fim                    date     NOT NULL,
    concessivo_fim         date     NOT NULL,
    faltas_injustificadas  smallint NOT NULL DEFAULT 0,
    dias_direito           smallint NOT NULL,
    status                 text     NOT NULL DEFAULT 'aberto',

    CONSTRAINT pa_periodo       CHECK (fim > inicio),
    CONSTRAINT pa_concessivo    CHECK (concessivo_fim > fim),
    CONSTRAINT pa_faltas        CHECK (faltas_injustificadas >= 0),
    CONSTRAINT pa_status        CHECK (status IN ('aberto','concluido','vencido')),
    -- RN10: a tabela de faltas da CLT só produz estes cinco valores
    CONSTRAINT pa_dias_direito  CHECK (dias_direito IN (0,12,18,24,30)),
    CONSTRAINT pa_direito_bate_faltas CHECK (
        dias_direito = CASE
            WHEN faltas_injustificadas <=  5 THEN 30
            WHEN faltas_injustificadas <= 14 THEN 24
            WHEN faltas_injustificadas <= 23 THEN 18
            WHEN faltas_injustificadas <= 32 THEN 12
            ELSE 0
        END
    ),
    CONSTRAINT pa_sem_sobreposicao EXCLUDE USING gist (
        colaborador_id WITH =,
        daterange(inicio, fim, '[]') WITH &&
    )
);

-- RF41 a RF43 — aqui mora a regra do setor desfalcado
CREATE TABLE ferias_gozo (
    id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    periodo_aquisitivo_id   bigint      NOT NULL REFERENCES ferias_periodo_aquisitivo(id),
    colaborador_id          bigint      NOT NULL REFERENCES colaborador(id),
    setor_id                bigint      NOT NULL REFERENCES setor(id),
    data_inicio             date        NOT NULL,
    data_fim                date        NOT NULL,
    dias                    smallint    GENERATED ALWAYS AS
                                        (data_fim - data_inicio + 1) STORED,
    abono_pecuniario_dias   smallint    NOT NULL DEFAULT 0,
    status                  text        NOT NULL DEFAULT 'solicitada',
    solicitado_por          bigint      NOT NULL REFERENCES usuario(id),
    solicitado_em           timestamptz NOT NULL DEFAULT now(),
    decidido_por            bigint      REFERENCES usuario(id),
    decidido_em             timestamptz,
    motivo_decisao          text,

    CONSTRAINT fg_periodo CHECK (data_fim >= data_inicio),
    CONSTRAINT fg_status  CHECK (status IN
        ('solicitada','aprovada','recusada','cancelada','gozada')),
    -- RN11: nenhum período de férias abaixo de 5 dias
    CONSTRAINT fg_minimo_5_dias CHECK (data_fim - data_inicio + 1 >= 5),
    CONSTRAINT fg_abono CHECK (abono_pecuniario_dias BETWEEN 0 AND 10),
    CONSTRAINT fg_decisao_coerente CHECK (
        (status =  'solicitada' AND decidido_por IS NULL     AND decidido_em IS NULL)
     OR (status <> 'solicitada' AND decidido_por IS NOT NULL AND decidido_em IS NOT NULL)
    ),
    CONSTRAINT fg_recusa_com_motivo
        CHECK (status <> 'recusada' OR motivo_decisao IS NOT NULL),
    CONSTRAINT fg_decisor_diferente
        CHECK (decidido_por IS NULL OR decidido_por <> solicitado_por),

    -- REGRA 1: a mesma pessoa nunca tem dois períodos de férias no mesmo dia.
    -- Vale só para férias que de fato acontecem; recusada e cancelada não contam.
    CONSTRAINT fg_pessoa_sem_sobreposicao EXCLUDE USING gist (
        colaborador_id WITH =,
        daterange(data_inicio, data_fim, '[]') WITH &&
    ) WHERE (status IN ('aprovada','gozada'))
);

COMMENT ON COLUMN ferias_gozo.setor_id IS
  'Setor vigente no momento da solicitação, copiado de colaborador_vinculo. '
  'Fica aqui porque o vínculo muda com o tempo e a regra do setor precisa saber '
  'qual setor ficaria desfalcado naquelas datas.';


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
CREATE OR REPLACE FUNCTION fn_ferias_limite_setor() RETURNS trigger AS $$
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
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ferias_limite_setor
    BEFORE INSERT OR UPDATE ON ferias_gozo
    FOR EACH ROW EXECUTE FUNCTION fn_ferias_limite_setor();


-- ----------------------------------------------------------------------------
-- REGRA 3: fracionamento e saldo de dias (RN11, CLT arts. 134 e 135).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_ferias_fracionamento() RETURNS trigger AS $$
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
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ferias_fracionamento
    BEFORE INSERT OR UPDATE ON ferias_gozo
    FOR EACH ROW EXECUTE FUNCTION fn_ferias_fracionamento();


-- ----------------------------------------------------------------------------
-- REGRA 4: férias não começam em feriado, em descanso semanal, nem nos 2 dias
-- anteriores a um deles (CLT art. 134 §3º).
-- Simplificação: o descanso semanal é tratado como sábado e domingo. A versão
-- exata consulta escala_dia do colaborador; trocar quando a escala estiver pronta.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_ferias_inicio_valido() RETURNS trigger AS $$
BEGIN
    IF NEW.status NOT IN ('aprovada','gozada') THEN
        RETURN NEW;
    END IF;

    IF EXISTS (
        SELECT 1 FROM feriado f
         WHERE NOT f.facultativo
           AND f.data BETWEEN NEW.data_inicio AND NEW.data_inicio + 2
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
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ferias_inicio_valido
    BEFORE INSERT OR UPDATE ON ferias_gozo
    FOR EACH ROW EXECUTE FUNCTION fn_ferias_inicio_valido();


-- ============================================================================
-- G. FECHAMENTO, ESPELHO E AUDITORIA
-- ============================================================================

-- RF46, RF49
CREATE TABLE fechamento (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    estabelecimento_id  bigint      NOT NULL REFERENCES estabelecimento(id),
    competencia         date        NOT NULL,     -- primeiro dia do mês
    data_inicio         date        NOT NULL,
    data_fim            date        NOT NULL,
    status              text        NOT NULL DEFAULT 'aberto',
    fechado_por         bigint      REFERENCES usuario(id),
    fechado_em          timestamptz,
    reaberto_por        bigint      REFERENCES usuario(id),
    reaberto_em         timestamptz,
    motivo_reabertura   text,

    CONSTRAINT fech_unico   UNIQUE (estabelecimento_id, competencia),
    CONSTRAINT fech_periodo CHECK (data_fim >= data_inicio),
    CONSTRAINT fech_status  CHECK (status IN ('aberto','fechado','reaberto')),
    CONSTRAINT fech_competencia_dia_1 CHECK (extract(day FROM competencia) = 1),
    CONSTRAINT fech_fechado_coerente CHECK (
        (status =  'aberto' AND fechado_por IS NULL)
     OR (status <> 'aberto' AND fechado_por IS NOT NULL AND fechado_em IS NOT NULL)
    ),
    -- RF49: reabertura sempre com autor e motivo
    CONSTRAINT fech_reabertura_coerente CHECK (
        status <> 'reaberto'
        OR (reaberto_por IS NOT NULL AND reaberto_em IS NOT NULL
            AND motivo_reabertura IS NOT NULL)
    )
);

-- RF47, RF48
CREATE TABLE espelho (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    fechamento_id   bigint NOT NULL REFERENCES fechamento(id) ON DELETE CASCADE,
    colaborador_id  bigint NOT NULL REFERENCES colaborador(id),
    pdf_url         text,
    ciencia_em      timestamptz,
    ciencia_ip      inet,

    CONSTRAINT espelho_unico   UNIQUE (fechamento_id, colaborador_id),
    CONSTRAINT espelho_ciencia CHECK ((ciencia_em IS NULL) = (ciencia_ip IS NULL))
);

-- RF60, RNF03
CREATE TABLE auditoria (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    usuario_id    bigint      REFERENCES usuario(id),
    entidade      text        NOT NULL,
    entidade_id   bigint      NOT NULL,
    acao          text        NOT NULL,
    dados_antes   jsonb,
    dados_depois  jsonb,
    motivo        text,
    criado_em     timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT auditoria_acao CHECK (acao IN (
        'criacao','alteracao','exclusao','leitura_sensivel',
        'aprovacao','recusa','fechamento','reabertura'))
);

COMMENT ON TABLE auditoria IS
  'Inclui a leitura de dado sensível (acao = leitura_sensivel), que é como a '
  'LGPD é atendida para CID e arquivo de atestado (RN15, RNF04).';

-- RNF03: auditoria é só de inserção
CREATE OR REPLACE FUNCTION fn_auditoria_imutavel() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Registro de auditoria não pode ser alterado nem removido (RNF03)'
        USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_auditoria_imutavel
    BEFORE UPDATE OR DELETE ON auditoria
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria_imutavel();


-- ----------------------------------------------------------------------------
-- RF46: período fechado não aceita alteração. Reabrir primeiro (RF49).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_bloqueia_periodo_fechado() RETURNS trigger AS $$
DECLARE
    v_colaborador bigint := COALESCE(NEW.colaborador_id, OLD.colaborador_id);
    v_data        date   := COALESCE(NEW.data, OLD.data);
BEGIN
    IF EXISTS (
        SELECT 1
          FROM fechamento f
          JOIN colaborador c ON c.estabelecimento_id = f.estabelecimento_id
         WHERE c.id = v_colaborador
           AND f.status = 'fechado'
           AND v_data BETWEEN f.data_inicio AND f.data_fim
    ) THEN
        RAISE EXCEPTION 'Período fechado em % para esse colaborador: reabra antes de alterar (RF46)',
            v_data USING ERRCODE = 'check_violation';
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_apuracao_periodo_fechado
    BEFORE INSERT OR UPDATE OR DELETE ON apuracao_dia
    FOR EACH ROW EXECUTE FUNCTION fn_bloqueia_periodo_fechado();

CREATE TRIGGER trg_ajuste_periodo_fechado
    BEFORE INSERT OR UPDATE ON ajuste
    FOR EACH ROW EXECUTE FUNCTION fn_bloqueia_periodo_fechado();


-- ============================================================================
-- ÍNDICES DE APOIO
-- ============================================================================

CREATE INDEX idx_colaborador_estab      ON colaborador (estabelecimento_id)
    WHERE data_desligamento IS NULL;
CREATE INDEX idx_colaborador_gestor     ON colaborador (gestor_id);
CREATE INDEX idx_vinculo_colab_vigencia ON colaborador_vinculo (colaborador_id, vigencia_inicio DESC);
CREATE INDEX idx_apuracao_colab_data    ON apuracao_dia (colaborador_id, data DESC);
CREATE INDEX idx_apuracao_data          ON apuracao_dia (data);
CREATE INDEX idx_marcacao_dia           ON apuracao_marcacao (apuracao_dia_id, sequencia);
CREATE INDEX idx_ajuste_pendente        ON ajuste (colaborador_id) WHERE status = 'pendente';
CREATE INDEX idx_atestado_pendente      ON atestado (colaborador_id) WHERE status = 'pendente';
CREATE INDEX idx_bh_colab               ON banco_horas_lancamento (colaborador_id, data_competencia);
CREATE INDEX idx_bh_vencimento          ON banco_horas_lancamento (data_vencimento)
    WHERE data_vencimento IS NOT NULL;
CREATE INDEX idx_ferias_setor_periodo   ON ferias_gozo (setor_id, data_inicio, data_fim)
    WHERE status IN ('aprovada','gozada');
CREATE INDEX idx_feriado_data           ON feriado (data);
CREATE INDEX idx_auditoria_entidade     ON auditoria (entidade, entidade_id, criado_em DESC);


-- ============================================================================
-- PENDÊNCIAS
-- ============================================================================
-- 1. colaborador, estabelecimento e usuario podem já existir no banco app.
--    Conferir antes de criar; se existirem, só acrescentar as colunas que faltam.
-- 2. salario_base em colaborador_vinculo: confirmar com o contador se é mesmo
--    necessário. Se não for, remover a coluna.
-- 3. feriado usa UNIQUE NULLS NOT DISTINCT (PostgreSQL 15+). Em versão anterior,
--    trocar por um índice único sobre COALESCE das colunas.
-- 4. fn_ferias_inicio_valido trata descanso semanal como sábado e domingo.
--    Trocar pela consulta a escala_dia quando a escala estiver implementada.
