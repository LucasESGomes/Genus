-- 0002: NSR, registros fiscais imutáveis, evidências e outbox do rep-core.
-- Ver docs/SPEC-nsr-fila.md §3. O rep-core transforma uma `entradas` pendente em
-- `registros` (NSR + hash encadeado) e `evidencias`, e registra no `outbox` os
-- eventos pós-batida na MESMA transação. Os papéis arp_core e arp_reader são
-- criados fora da migration (init do Postgres), como arp_collector na 0001.
-- Portaria 671 (arts. 74, 82 e 98): `registros` e `evidencias` só recebem INSERT;
-- nenhum papel, nem o dono, altera ou apaga uma marcação.

-- Contador de NSR por estabelecimento. O rep-core trava a linha com FOR UPDATE
-- para que o NSR não tenha buraco nem repetição.
CREATE TABLE sequencias_estabelecimento (
    estabelecimento_id BIGINT      NOT NULL,
    conta_id           BIGINT      NOT NULL,
    ultimo_nsr         BIGINT      NOT NULL DEFAULT 0,
    ultimo_hash        BYTEA,
    atualizado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT pk_sequencias_estabelecimento PRIMARY KEY (estabelecimento_id),
    CONSTRAINT ck_sequencias_estabelecimento_ultimo_nsr CHECK (ultimo_nsr >= 0),
    CONSTRAINT ck_sequencias_estabelecimento_ultimo_hash CHECK (ultimo_hash IS NULL OR octet_length(ultimo_hash) = 32)
);

-- Registro fiscal (só INSERT).
CREATE TABLE registros (
    estabelecimento_id  BIGINT      NOT NULL,
    nsr                 BIGINT      NOT NULL,
    conta_id            BIGINT      NOT NULL,
    tipo                TEXT        NOT NULL,
    cpf                 CHAR(11),
    marcado_em          TIMESTAMPTZ NOT NULL,
    gravado_em          TIMESTAMPTZ NOT NULL,
    tipo_coletor        CHAR(2)     NOT NULL,
    eh_offline          BOOLEAN     NOT NULL,
    hash                BYTEA       NOT NULL,
    hash_anterior       BYTEA       NOT NULL,
    versao_formato_hash SMALLINT    NOT NULL,
    criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT pk_registros PRIMARY KEY (estabelecimento_id, nsr),
    CONSTRAINT ck_registros_nsr CHECK (nsr > 0),
    CONSTRAINT ck_registros_tipo CHECK (tipo IN ('2', '4', '5', '6', '7')),
    CONSTRAINT ck_registros_cpf CHECK (cpf IS NULL OR cpf ~ '^[0-9]{11}$'),
    -- Registro tipo 7 (marcação) sem CPF não identifica ninguém.
    CONSTRAINT ck_registros_cpf_tipo_7 CHECK (tipo <> '7' OR cpf IS NOT NULL),
    CONSTRAINT ck_registros_tipo_coletor CHECK (tipo_coletor IN ('01', '02', '03', '04', '05')),
    CONSTRAINT ck_registros_hash CHECK (octet_length(hash) = 32),
    CONSTRAINT ck_registros_hash_anterior CHECK (octet_length(hash_anterior) = 32),
    CONSTRAINT ck_registros_versao_formato_hash CHECK (versao_formato_hash > 0)
);

CREATE INDEX idx_registros_conta_id_cpf_marcado_em ON registros (conta_id, cpf, marcado_em DESC) WHERE cpf IS NOT NULL;

-- Evidência da marcação (só INSERT): liga o registro à entrada e ao aparelho.
CREATE TABLE evidencias (
    estabelecimento_id   BIGINT      NOT NULL,
    nsr                  BIGINT      NOT NULL,
    conta_id             BIGINT      NOT NULL,
    entrada_id           BIGINT      NOT NULL,
    aparelho_id          BIGINT      NOT NULL,
    sequencia_aparelho   BIGINT      NOT NULL,
    colaborador_id       BIGINT      NOT NULL,
    metodo_identificacao TEXT        NOT NULL,
    nota_reconhecimento  REAL,
    nota_vivacidade      REAL,
    eh_hora_divergente   BOOLEAN     NOT NULL DEFAULT false,
    criado_em            TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT pk_evidencias PRIMARY KEY (estabelecimento_id, nsr),
    CONSTRAINT fk_evidencias_registro FOREIGN KEY (estabelecimento_id, nsr) REFERENCES registros (estabelecimento_id, nsr),
    CONSTRAINT fk_evidencias_entrada FOREIGN KEY (entrada_id) REFERENCES entradas (id),
    -- Idempotência: uma entrada gera no máximo uma evidência.
    CONSTRAINT uq_evidencias_entrada_id UNIQUE (entrada_id),
    CONSTRAINT uq_evidencias_aparelho_id_sequencia_aparelho UNIQUE (aparelho_id, sequencia_aparelho),
    CONSTRAINT ck_evidencias_metodo_identificacao CHECK (metodo_identificacao IN ('facial')),
    CONSTRAINT ck_evidencias_nota_reconhecimento CHECK (nota_reconhecimento IS NULL OR nota_reconhecimento BETWEEN 0 AND 1),
    CONSTRAINT ck_evidencias_nota_vivacidade CHECK (nota_vivacidade IS NULL OR nota_vivacidade BETWEEN 0 AND 1)
);

-- Outbox transacional do rep-core: a fonte da verdade dos eventos pós-batida;
-- a fila (BullMQ) só transporta.
CREATE TABLE outbox (
    id                 BIGINT GENERATED ALWAYS AS IDENTITY,
    conta_id           BIGINT      NOT NULL,
    id_publico         UUID        NOT NULL DEFAULT gen_random_uuid(),
    estabelecimento_id BIGINT      NOT NULL,
    evento             TEXT        NOT NULL,
    chave              TEXT        NOT NULL,
    payload            JSONB       NOT NULL,
    status             TEXT        NOT NULL DEFAULT 'pendente',
    tentativas         INTEGER     NOT NULL DEFAULT 0,
    processado_em      TIMESTAMPTZ,
    criado_em          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT pk_outbox PRIMARY KEY (id),
    CONSTRAINT uq_outbox_id_publico UNIQUE (id_publico),
    CONSTRAINT uq_outbox_evento_chave UNIQUE (evento, chave),
    CONSTRAINT ck_outbox_evento CHECK (evento IN ('generate-receipt-pdf', 'recalculate-day', 'official-qr')),
    CONSTRAINT ck_outbox_status CHECK (status IN ('pendente', 'processado', 'falhou')),
    CONSTRAINT ck_outbox_tentativas CHECK (tentativas >= 0)
);

CREATE INDEX idx_outbox_pendentes ON outbox (criado_em) WHERE status = 'pendente';

COMMENT ON TABLE sequencias_estabelecimento IS 'Contador de NSR e último hash por estabelecimento; o rep-core trava a linha com FOR UPDATE.';
COMMENT ON COLUMN sequencias_estabelecimento.ultimo_nsr IS 'Último NSR atribuído (0 = nenhum ainda).';
COMMENT ON COLUMN sequencias_estabelecimento.ultimo_hash IS 'Hash do último registro; NULL antes do primeiro (o genesis é 32 bytes zero, no rep-core).';
COMMENT ON TABLE registros IS 'Registros fiscais com NSR e hash encadeado. Só INSERT: trigger recusa UPDATE, DELETE e TRUNCATE para qualquer papel.';
COMMENT ON COLUMN registros.nsr IS 'Número Sequencial de Registro, contíguo por estabelecimento a partir de 1.';
COMMENT ON COLUMN registros.tipo IS 'Tipo do registro do AFD (2, 4, 5, 6 ou 7 = marcação).';
COMMENT ON COLUMN registros.marcado_em IS 'Hora da marcação, com precisão de milissegundos (entra no hash).';
COMMENT ON COLUMN registros.gravado_em IS 'Instante da gravação do registro, com precisão de milissegundos (entra no hash).';
COMMENT ON COLUMN registros.tipo_coletor IS 'Tipo de coletor do AFD: 01 a 05.';
COMMENT ON COLUMN registros.hash IS 'SHA-256 (32 bytes) do registro; fórmula em apps/rep-core/src/nsr/hash.ts.';
COMMENT ON COLUMN registros.hash_anterior IS 'Hash do registro anterior do estabelecimento; 32 bytes zero no primeiro.';
COMMENT ON COLUMN registros.versao_formato_hash IS 'Versão da fórmula do hash; trocar a fórmula cria nova versão e o passado não é reinterpretado.';
COMMENT ON TABLE evidencias IS 'Evidência de cada registro (entrada, aparelho, notas). Só INSERT, como registros.';
COMMENT ON COLUMN evidencias.entrada_id IS 'Entrada de origem; UNIQUE garante idempotência do worker.';
COMMENT ON TABLE outbox IS 'Eventos pós-batida gravados na mesma transação do NSR; a fila só transporta.';
COMMENT ON COLUMN outbox.chave IS 'Identifica o registro: <estabelecimento_id>-<nsr>.';
COMMENT ON COLUMN outbox.payload IS 'Só identificadores, nunca dado pessoal: { establishmentId, nsr }.';
COMMENT ON COLUMN outbox.status IS 'pendente (aguarda consumidor), processado ou falhou.';

-- Mantém atualizado_em em sequencias_estabelecimento.
CREATE FUNCTION definir_atualizado_em() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.atualizado_em := now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sequencias_estabelecimento_atualizado_em
    BEFORE UPDATE ON sequencias_estabelecimento
    FOR EACH ROW EXECUTE FUNCTION definir_atualizado_em();

-- (a) Imutabilidade fiscal. Vale para QUALQUER papel, inclusive o dono e o
-- superusuário: triggers não dependem de permissão. Quem quiser alterar precisa
-- desabilitar o trigger de propósito (e isso aparece em auditoria de DDL).
CREATE FUNCTION recusar_alteracao_fiscal() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'A tabela % só aceita INSERT: % é proibido (Portaria 671, registros fiscais são imutáveis).',
        TG_TABLE_NAME, TG_OP
        USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER trg_registros_imutavel
    BEFORE UPDATE OR DELETE ON registros
    FOR EACH ROW EXECUTE FUNCTION recusar_alteracao_fiscal();
CREATE TRIGGER trg_registros_sem_truncate
    BEFORE TRUNCATE ON registros
    FOR EACH STATEMENT EXECUTE FUNCTION recusar_alteracao_fiscal();
CREATE TRIGGER trg_evidencias_imutavel
    BEFORE UPDATE OR DELETE ON evidencias
    FOR EACH ROW EXECUTE FUNCTION recusar_alteracao_fiscal();
CREATE TRIGGER trg_evidencias_sem_truncate
    BEFORE TRUNCATE ON evidencias
    FOR EACH STATEMENT EXECUTE FUNCTION recusar_alteracao_fiscal();

-- (b) Uma entrada só vira 'processado' se o registro fiscal e os eventos
-- pós-batida já existem. Por isso, no worker, o UPDATE de entradas é o ÚLTIMO
-- passo da transação (SPEC §2).
--
-- ATENÇÃO: a lista de eventos abaixo é a do registro tipo 7 hoje
-- (generate-receipt-pdf, recalculate-day, official-qr). Uma migration futura que
-- acrescentar um evento a esse tipo DEVE recriar esta função (CREATE OR REPLACE)
-- e o CHECK ck_outbox_evento; senão entradas passam a ser aceitas sem o evento novo.
CREATE FUNCTION exigir_registro_para_processar() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_estabelecimento_id BIGINT;
    v_nsr                BIGINT;
    v_conta_id           BIGINT;
    v_chave              TEXT;
    v_eventos            INTEGER;
BEGIN
    -- 'processado' é terminal: nada mais muda, nem tentativas.
    IF OLD.status = 'processado' THEN
        RAISE EXCEPTION 'A entrada % já está processada e não pode mais ser alterada.', OLD.id
            USING ERRCODE = 'restrict_violation';
    END IF;

    -- O rep-core só pode mexer em status, tentativas e processado_em. As demais
    -- colunas descrevem a batida recebida e não mudam nunca.
    IF (NEW.id, NEW.conta_id, NEW.id_publico, NEW.estabelecimento_id, NEW.aparelho_id,
        NEW.sequencia_aparelho, NEW.colaborador_id, NEW.cpf, NEW.marcado_em, NEW.recebido_em,
        NEW.eh_hora_divergente, NEW.metodo_identificacao, NEW.nota_reconhecimento,
        NEW.nota_vivacidade, NEW.criado_em)
       IS DISTINCT FROM
       (OLD.id, OLD.conta_id, OLD.id_publico, OLD.estabelecimento_id, OLD.aparelho_id,
        OLD.sequencia_aparelho, OLD.colaborador_id, OLD.cpf, OLD.marcado_em, OLD.recebido_em,
        OLD.eh_hora_divergente, OLD.metodo_identificacao, OLD.nota_reconhecimento,
        OLD.nota_vivacidade, OLD.criado_em)
    THEN
        RAISE EXCEPTION 'Só status, tentativas e processado_em de entradas podem ser alterados (entrada %).', OLD.id
            USING ERRCODE = 'restrict_violation';
    END IF;

    IF NEW.status = 'processado' THEN
        SELECT estabelecimento_id, nsr, conta_id
          INTO v_estabelecimento_id, v_nsr, v_conta_id
          FROM evidencias
         WHERE entrada_id = NEW.id;

        IF NOT FOUND OR v_conta_id <> NEW.conta_id OR v_estabelecimento_id <> NEW.estabelecimento_id THEN
            RAISE EXCEPTION 'A entrada % não pode ser processada sem a evidência do seu registro.', NEW.id
                USING ERRCODE = 'restrict_violation';
        END IF;

        v_chave := v_estabelecimento_id::text || '-' || v_nsr::text;
        SELECT count(DISTINCT evento) INTO v_eventos
          FROM outbox
         WHERE chave = v_chave
           AND estabelecimento_id = v_estabelecimento_id
           AND evento IN ('generate-receipt-pdf', 'recalculate-day', 'official-qr');

        IF v_eventos <> 3 THEN
            RAISE EXCEPTION 'A entrada % não pode ser processada: o outbox do registro % tem % de 3 eventos.',
                NEW.id, v_chave, v_eventos
                USING ERRCODE = 'restrict_violation';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_entradas_exigir_registro
    BEFORE UPDATE ON entradas
    FOR EACH ROW EXECUTE FUNCTION exigir_registro_para_processar();

-- Permissões. Papéis arp_core e arp_reader criados fora da migration.
-- Sem DELETE e sem TRUNCATE para ninguém além do que o trigger já barra.
REVOKE ALL ON sequencias_estabelecimento FROM PUBLIC;
REVOKE ALL ON registros FROM PUBLIC;
REVOKE ALL ON evidencias FROM PUBLIC;
REVOKE ALL ON outbox FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE ON sequencias_estabelecimento TO arp_core;
GRANT SELECT, INSERT ON registros, evidencias, outbox TO arp_core;
GRANT SELECT ON entradas TO arp_core;
GRANT UPDATE (status, tentativas, processado_em) ON entradas TO arp_core;

GRANT SELECT ON sequencias_estabelecimento, registros, evidencias, outbox, entradas TO arp_reader;
