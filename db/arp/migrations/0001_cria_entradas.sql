-- 0001: cria `entradas`, o outbox transacional da api do coletor.
-- Cada batida identificada pelo face-engine entra aqui como 'pendente' e
-- aguarda o rep-core (ainda inexistente), que atribuirá NSR e hash.
-- Portaria 671: a api do coletor só faz INSERT e SELECT; nada bloqueia
-- uma marcação, e nenhuma rota edita ou apaga.

CREATE TABLE entradas (
    id                   BIGINT GENERATED ALWAYS AS IDENTITY,
    conta_id             BIGINT       NOT NULL,
    id_publico           UUID         NOT NULL DEFAULT gen_random_uuid(),
    estabelecimento_id   BIGINT       NOT NULL,
    aparelho_id          BIGINT       NOT NULL,
    sequencia_aparelho   BIGINT       NOT NULL,
    colaborador_id       BIGINT       NOT NULL,
    cpf                  CHAR(11)     NOT NULL,
    marcado_em           TIMESTAMPTZ  NOT NULL,
    recebido_em          TIMESTAMPTZ  NOT NULL,
    eh_hora_divergente   BOOLEAN      NOT NULL DEFAULT false,
    metodo_identificacao TEXT         NOT NULL,
    nota_reconhecimento  REAL,
    nota_vivacidade      REAL,
    status               TEXT         NOT NULL DEFAULT 'pendente',
    tentativas           INTEGER      NOT NULL DEFAULT 0,
    processado_em        TIMESTAMPTZ,
    criado_em            TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT pk_entradas PRIMARY KEY (id),
    CONSTRAINT uq_entradas_id_publico UNIQUE (id_publico),
    -- Padrão database.md seção 6 (alvo de FK composta das filhas).
    CONSTRAINT uq_entradas_conta_id_id UNIQUE (conta_id, id),
    -- Chave de idempotência do aparelho.
    -- [A CONFIRMAR] não inclui conta_id (contraria database.md §6) porque o
    -- aparelho é global e pertence a uma única conta; revisitar quando a
    -- tabela de aparelhos existir no banco app.
    CONSTRAINT uq_entradas_aparelho_id_sequencia_aparelho UNIQUE (aparelho_id, sequencia_aparelho),
    CONSTRAINT ck_entradas_sequencia_aparelho CHECK (sequencia_aparelho > 0),
    CONSTRAINT ck_entradas_cpf CHECK (cpf ~ '^[0-9]{11}$'),
    CONSTRAINT ck_entradas_metodo_identificacao CHECK (metodo_identificacao IN ('facial')),
    CONSTRAINT ck_entradas_nota_reconhecimento CHECK (nota_reconhecimento IS NULL OR nota_reconhecimento BETWEEN 0 AND 1),
    CONSTRAINT ck_entradas_nota_vivacidade CHECK (nota_vivacidade IS NULL OR nota_vivacidade BETWEEN 0 AND 1),
    CONSTRAINT ck_entradas_status CHECK (status IN ('pendente', 'processado', 'falhou')),
    CONSTRAINT ck_entradas_tentativas CHECK (tentativas >= 0)
);

-- Fila de pendências do rep-core.
CREATE INDEX idx_entradas_pendentes ON entradas (conta_id, criado_em) WHERE status = 'pendente';
-- Checagem de duplicidade (mesmo CPF nos últimos 60 s); só sinaliza, nunca bloqueia.
CREATE INDEX idx_entradas_conta_id_cpf_marcado_em ON entradas (conta_id, cpf, marcado_em DESC);

COMMENT ON TABLE entradas IS 'Outbox transacional da api do coletor: batidas identificadas aguardando o rep-core (NSR e hash).';
COMMENT ON COLUMN entradas.id_publico IS 'Identificador devolvido ao aparelho como recibo (receiptId).';
COMMENT ON COLUMN entradas.sequencia_aparelho IS 'Contador monotônico do aparelho; com aparelho_id forma a chave de idempotência.';
COMMENT ON COLUMN entradas.cpf IS 'CPF do colaborador identificado, só dígitos.';
COMMENT ON COLUMN entradas.marcado_em IS 'Hora oficial da marcação, conforme o aparelho.';
COMMENT ON COLUMN entradas.recebido_em IS 'Instante em que a api recebeu a batida.';
COMMENT ON COLUMN entradas.eh_hora_divergente IS 'Sinaliza divergência entre a hora do aparelho e a do servidor; apenas sinaliza, nunca bloqueia.';
COMMENT ON COLUMN entradas.metodo_identificacao IS 'Como o colaborador foi identificado (hoje, só facial).';
COMMENT ON COLUMN entradas.nota_reconhecimento IS 'Similaridade do reconhecimento facial, entre 0 e 1.';
COMMENT ON COLUMN entradas.nota_vivacidade IS 'Nota da prova de vivacidade, entre 0 e 1.';
COMMENT ON COLUMN entradas.status IS 'pendente (aguarda o rep-core), processado ou falhou.';
COMMENT ON COLUMN entradas.tentativas IS 'Quantas vezes o rep-core tentou processar a entrada.';

-- Permissões. O papel arp_collector é criado pelo init do Postgres (fora da migration).
-- Não há trigger de imutabilidade aqui: o rep-core (futuro) fará UPDATE de status
-- nesta tabela. A proteção é por permissão: a api do coletor só tem INSERT e SELECT.
-- A identity é GENERATED ALWAYS: o Postgres não exige USAGE na sequência interna
-- para INSERT, então nenhuma permissão de sequência é concedida.
REVOKE ALL ON entradas FROM PUBLIC;
GRANT SELECT, INSERT ON entradas TO arp_collector;
