-- 0003: consulta de status da batida pela api do coletor.
-- GET /coletor/batidas/jobs/:jobId e GET /coletor/batidas?employeeId= mostram
-- se a entrada já virou registro fiscal e com qual NSR. O NSR está em
-- `evidencias`, que a api do coletor ainda não lia.
-- A api continua sem escrever em nada além de `entradas` (INSERT): aqui só
-- entra leitura. `evidencias` não tem CPF nem dado sensível.

GRANT SELECT ON evidencias TO arp_collector;

-- Listagem por colaborador, da mais recente para a mais antiga.
CREATE INDEX idx_entradas_conta_id_colaborador_id_marcado_em
    ON entradas (conta_id, colaborador_id, marcado_em DESC);
