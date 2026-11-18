# 02 · Arquitetura do sistema

> Documento 2 de 3. Contexto legal em `01-contexto-e-portaria.md`; funcionalidades e modos em `03-funcionalidades-e-modos.md`.
> Diagramas (draw.io): `tiers-rep-p.drawio`, com uma página por tier. O arquivo `arquitetura-rep-p.drawio` é uma versão anterior, maior, mantida só como referência.
>
> **Para quem for revisar:** capacidades e custos são **estimativas**, ainda não medidas. Os dois primeiros testes previstos (seção 10) servem para confirmá-las.

---

## 1. Princípios

1. **Núcleo fiscal pequeno e isolado.** Só o `rep-core` escreve no banco fiscal (ARP). O resto lê. O registro no INPI e o atestado técnico ficam presos à versão do núcleo.
2. **O reconhecimento facial é o único passo pesado e síncrono.** Tudo o que vem depois é assíncrono e pode atrasar minutos num pico sem prejuízo.
3. **Nenhuma batida existe só na memória.** Ela está sempre em pelo menos um disco: do aparelho, do Postgres ou do S3.
4. **O aparelho é o primeiro outbox.** Ele grava a batida antes de enviar e só a considera confirmada quando recebe a resposta.
5. **O sistema nunca bloqueia a marcação** (art. 74). Falhas degradam o método de identificação, mas a batida sempre entra.
6. **Pouca dependência de nuvem.** Da AWS, ou de outro provedor, usar só VM, S3 e, a partir do Tier 3, load balancer. O resto é software aberto.
7. **Começar pequeno.** Uma réplica de cada coisa e escalar primeiro o reconhecimento.

---

## 2. Stack

| Camada | Tecnologia | Motivo |
|---|---|---|
| APIs e workers | **Node.js (LTS) + TypeScript + Fastify**, validação com **Zod** | O fundador já domina; a carga é baixa; BullMQ é nativo de Node |
| Acesso ao banco | **Drizzle** no banco `app`; **SQL puro** no `rep-core` | A transação do NSR precisa de controle total |
| Portais | **Next.js** + Tailwind + shadcn/ui | Mesmo ecossistema |
| Login dos portais | **Better Auth** (senha + TOTP) | Roda dentro da aplicação; Keycloak só no Tier 3, se precisar de SSO |
| Motor facial | **Python + ONNX Runtime + FastAPI** | A Visage já é Python. No Tier 3 com GPU, avaliar NVIDIA Triton |
| Assinatura (PAdES/CAdES) | **Python + pyHanko** | Em Node, as bibliotecas de PAdES são fracas |
| Banco | **PostgreSQL** | Fonte da verdade, inclusive das tabelas de outbox |
| Fila | **BullMQ sobre Valkey** | Transporte das mensagens; retry, backoff e painel (Bull Board) prontos |
| App do aparelho | **React Native + Expo** (dev client) + módulos nativos | Ver seção 4.1 |
| Coletor no PC | O mesmo app em versão **web (PWA), só modo online** | Navegador não tem chave em chip nem armazenamento offline confiável |
| Infra / deploy | **Docker Compose** (Tiers 1 e 2); OpenTofu + Ansible; GitHub Actions | k3s só se for necessário no Tier 3 |
| Segredos | **SOPS + age** (Tiers 1 e 2); **OpenBao** (Tier 3) | **[A CONFIRMAR]:** se o Transit do OpenBao aceita importar a chave RSA do e-CNPJ |
| Monitoramento | Monitor externo de disponibilidade (UptimeRobot, Healthchecks.io) + logs; Grafana/Prometheus/Loki a partir do Tier 3 | O alerta de "VM caiu" precisa vir de fora da VM |
| Testes | Vitest, Playwright, **k6** (carga) | Teste crítico: 200 batidas simultâneas no mesmo estabelecimento → NSR sem buracos e cadeia de hash íntegra |

**Alternativas avaliadas:** Go (menor consumo, poucas dependências), Kotlin/Java (melhor ecossistema ICP-Brasil, como Demoiselle Signer e DSS) e C#. A decisão foi TypeScript por velocidade de entrega de um fundador solo. A fraqueza de PAdES fica coberta pelo signer em Python.

---

## 3. Visão geral (Tier 1)

```
Aparelhos ──HTTPS+mTLS──►┌──────────────── VM 1 · core ─────────────────┐   ┌── VM 2 · reconhecimento ──┐
                         │ nginx                                         │   │ face-engine (Python)      │
Navegadores ─Cloudflare─►│  ├─ api-coletor ──① "quem é?" ───────────────┼──►│ pg_receivewal (WAL sínc.) │
                         │  ├─ api-portal + Next.js                      │   └───────────────────────────┘
                         │  └─ signer (Python, interno)                  │
                         │ Workers: rep-core · jobs · resgate            │
                         │ PostgreSQL: banco arp + banco app             │──► S3: PDFs · AFD · WORM · backups
                         │ Valkey + BullMQ: fila batidas · fila pós-batida│
                         └───────────────────────────────────────────────┘
```

---

## 4. Componentes

### 4.1 Aparelho coletor (app)

- **React Native + Expo**. Android é o alvo nº 1 (tablet barato); também roda em iOS.
- **Módulos nativos:**
  - **Câmera:** `react-native-vision-camera`, que analisa os quadros em tempo real só para enquadrar o rosto e checar a qualidade.
  - **Chave do aparelho:** gerada no **Android Keystore/StrongBox** ou no **Secure Enclave**. A chave privada não sai do chip. Exige módulo nativo próprio.
  - **Banco local:** SQLite cifrado (**SQLCipher**, via `op-sqlite`).
  - **Relógio:** monotônico (`elapsedRealtime`) e hora do GNSS, para o modo offline.
  - **Modo Campo:** `onnxruntime-react-native`, com o modelo reduzido da Visage.
  - **Modo quiosque:** lock task do Android.
- **Guarda:** fila local das batidas, lista de funcionários do estabelecimento (CPF, nome, PIN cifrado, sem biometria), hora assinada mais recente, chave pública de ingestão e, no modo Campo, galeria facial cifrada.

### 4.2 Borda

| Peça | Função |
|---|---|
| **DNS / Cloudflare** | DNS de tudo. Proxy e WAF **só para os portais**. O tráfego dos aparelhos é DNS-only: se o proxy abrisse a conexão, o certificado do aparelho (mTLS) se perderia. |
| **IP fixo (Tiers 1 e 2)** / **load balancer camada 4, em passthrough (Tier 3)** | Entrega a conexão ainda cifrada ao nginx. |
| **nginx** | Abre o TLS. **Confere o certificado do aparelho** (`ssl_verify_client`, CA interna emitida pelo step-ca). Rotas: `/coletor` → api-coletor; `/portal` e `/v` → api-portal; `/fiscal` → rep-core. Limite de requisições por aparelho e por cliente; limite de tamanho de envio. |

### 4.3 APIs (respondem HTTP)

| API | Linguagem | Exposta? | Responsabilidade |
|---|---|---|---|
| **api-coletor** | Node | Sim, com mTLS | Batidas online, lotes offline, hora assinada, config, provisionamento de aparelho. Chama o face-engine e grava na tabela `entrada`. |
| **api-portal + Next.js** | Node | Sim, com login | Portais de RH, trabalhador e fiscal; página pública do QR (`GET /v/{id}`, com cache curto). |
| **face-engine** | Python | **Não** (só rede interna / WireGuard) | `POST /identificar` (1:N na galeria do estabelecimento, prova de vida), `POST /verificar` (1:1), `POST /cadastrar` (gera o vetor). Galeria em memória, recarregada por evento. |
| **signer** | Python | **Não** | Assina comprovante (PAdES), AFD e AEJ (CAdES .p7s) com o e-CNPJ. |
| **rep-core `/afd`** | Node | Via `/fiscal`, com login de RH | Gera o AFD por estabelecimento e período. |

### 4.4 Workers (processos de fundo, sem tela)

| Worker | Consome | Faz |
|---|---|---|
| **rep-core** (núcleo REP-P) | `fila batidas` | Transação do NSR (seção 6); grava eventos no `outbox`; publica na `fila pós-batida`. Também grava os registros tipo 2, 4, 5 e 6. |
| **jobs** | `fila pós-batida` + agendamentos | Gera o PDF do comprovante (chama o signer, salva no S3); calcula a jornada (PTRP); marca o QR como oficial; verifica fotos (modo degradado/offline); espelho mensal; selo diário no WORM; conferência das cadeias de hash; limpeza de fotos. |
| **resgate** | Tabelas `entrada` e `outbox` | A cada 15–30 s, republica eventos `pendentes` há mais de 30 s. |

### 4.5 Dados

**PostgreSQL**, com dois bancos lógicos no mesmo servidor (Tiers 1 e 2) ou em clusters separados (Tier 3).

**Banco `arp` (fiscal: só cresce)**

| Tabela | Conteúdo |
|---|---|
| `sequencia_estabelecimento` | `ultimo_nsr` e `ultimo_hash` por estabelecimento |
| `registros` | Tipos 2, 4, 5, 6 e 7 no formato do AFD. Chave: (estabelecimento, NSR) |
| `evidencias` | Dados internos que não vão para o AFD: ID e sequência do aparelho, assinatura do aparelho, fonte da hora, nota de prova de vida, método de identificação. **UNIQUE (aparelho, sequência).** |
| `entrada` | Outbox da api-coletor: batidas identificadas, `pendente → processado` |
| `outbox` | Eventos do rep-core ("gerar PDF", "calcular jornada", "QR oficial"), `pendente → processado/falhou` |

**Proteções do banco `arp`:**
- o papel do rep-core tem **só INSERT** em `registros` e `evidencias`;
- **trigger que recusa UPDATE e DELETE** em `registros`;
- os demais serviços leem com papel somente leitura;
- a api-coletor tem permissão só de INSERT em `entrada`.

**Banco `app` (operacional: muda o tempo todo)**

Empresas, estabelecimentos, funcionários, aparelhos, usuários, galerias faciais (vetores cifrados), tratamentos do RH, jornadas, espelhos, contestações e status dos recibos QR.

Cadastrar ou alterar empregador e empregado atualiza o `app` (estado atual) **e** gera registro tipo 2/5 no `arp` (o fato, com responsável e data/hora).

**Valkey + BullMQ: transporte, não fonte da verdade**

| Fila | jobId (idempotência) | Publicador | Consumidor |
|---|---|---|---|
| `batidas` | aparelho + sequência | api-coletor e resgate | rep-core |
| `pós-batida` | NSR + tarefa | rep-core e resgate | jobs |

- Persistência AOF a cada 1 s. Perder até 1 s de mensagens é aceitável, porque o resgate e o aparelho reenviam.

**S3 (ou compatível)**
- **App:** comprovantes (PDF), AFD, AEJ, lotes offline brutos (cifrados), fotos temporárias (**TTL de 7 dias**).
- **WORM (Object Lock, modo compliance):** selo diário das cadeias.
- **Backups:** WAL contínuo do Postgres (pgBackRest), snapshots, réplica em outra região.

---

## 5. Mensageria: transactional outbox + BullMQ + resgate

### 5.1 Regra geral

1. **COMMIT** do evento numa tabela com status `pendente`. A partir daqui ele existe em disco.
2. **Depois** do commit, publicar na fila BullMQ com um `jobId` determinístico. **Nunca dentro da transação:** banco e broker são sistemas diferentes.
3. O **consumidor** processa e marca `processado` **ao terminar**. Quem publica não marca nada.
4. O **resgate** roda sempre e republica o que estiver `pendente` há mais de 30 s.
5. Entrega **"pelo menos uma vez"**. Duplicatas são neutralizadas pelo `jobId` no BullMQ e pela **unicidade no banco**, que é a garantia real.
6. Depois de N tentativas, o evento vai para `falhou`: **não some**, gera alerta e é reprocessável.

### 5.2 Onde cada falha é coberta

| Falha | Cobertura |
|---|---|
| Rede cai antes do commit na `entrada` | O aparelho não recebe resposta e reenvia. |
| Processo cai entre o commit e a resposta | O aparelho reenvia; UNIQUE (aparelho, sequência) devolve o mesmo recibo. |
| Processo cai entre o commit e a publicação na fila | O resgate republica. |
| Valkey perde a mensagem | O evento continua `pendente`; o resgate republica. |
| rep-core cai no meio da transação | Rollback; a `entrada` continua `pendente`; reprocessa. |
| Worker de jobs cai no meio | O evento continua `pendente`; reprocessa (PDF no mesmo caminho do S3 = idempotente). |
| Disco da VM core morre | Restauração do S3 + `pg_receivewal` (seção 8). Os aparelhos guardam as batidas confirmadas por 7 dias. |
| VM core fora por 40 min | Os aparelhos entram em modo offline e reenviam na volta; eventos 08 e 07 gravados. |

---

## 6. Geração do NSR e da cadeia de hash

O NSR é atribuído **no banco, na gravação**, pelo rep-core, numa transação única:

```sql
BEGIN;
  -- trava só este estabelecimento; outros gravam em paralelo
  SELECT ultimo_nsr, ultimo_hash
    FROM sequencia_estabelecimento
   WHERE estabelecimento = $1
     FOR UPDATE;

  -- idempotência: se (aparelho, sequência) já existe em evidencias,
  -- devolve o NSR existente e faz ROLLBACK

  -- nsr = ultimo_nsr + 1
  -- dh_gravacao = now()   (relógio do servidor, sincronizado com o ON via chrony)
  -- hash = SHA-256(nsr | tipo | dh_marcacao | cpf | dh_gravacao | coletor | on/off | ultimo_hash)

  INSERT INTO registros  (...);
  INSERT INTO evidencias (...);
  UPDATE sequencia_estabelecimento SET ultimo_nsr = nsr, ultimo_hash = hash WHERE estabelecimento = $1;
  UPDATE entrada SET status = 'processado' WHERE id = $entrada;
  INSERT INTO outbox (evento, chave, status) VALUES ('gerar_pdf', ..., 'pendente'), ('calcular_jornada', ...), ('qr_oficial', ...);
COMMIT;
-- depois do COMMIT: publicar os eventos do outbox na fila pós-batida
```

- **Ordem do NSR = ordem de gravação**, não de marcação. Uma batida offline das 07:58 que chega às 10:00 recebe o NSR da vez às 10:00, com as duas horas registradas, como o AFD prevê.
- **A ordem é garantida pelo `FOR UPDATE` no banco, não pela fila.** Por isso a fila não precisa ser FIFO.
- Os registros tipo 2, 4, 5 e 6 entram na **mesma sequência e na mesma cadeia**.
- Um job noturno recalcula as cadeias e grava o último NSR e o último hash de cada estabelecimento no bucket **WORM**.

---

## 7. Hora

- **Servidores:** chrony sincronizando com o Observatório Nacional (`ntp.on.br`, `a.st1.ntp.br`). Alerta se a diferença passar de 5 s; a Portaria tolera 30 s. Ajustes relevantes geram registro tipo 4.
- **`dh_gravacao`:** relógio do banco.
- **`dh_marcacao` online:** hora da captura no aparelho, corrigida pelo offset da **hora assinada** recebida do servidor. Se divergir em mais de 30 s da chegada, usa a hora de chegada e sinaliza.
- **`dh_marcacao` offline:** última hora assinada + tempo decorrido no relógio monotônico. Se o aparelho reiniciou, usa a hora do GNSS. Sem nenhuma das duas, usa a hora do sistema com a marca "fonte não confiável". Mudanças na hora do sistema ficam em `evidencias`.

---

## 8. Criptografia e certificados

| Chave / certificado | Uso | Onde fica |
|---|---|---|
| e-CNPJ A1 ICP-Brasil (desenvolvedor) | Assina comprovante (PAdES), AFD e AEJ (CAdES) | `.pfx` cifrado com SOPS, aberto só pelo container do signer (Tiers 1 e 2); OpenBao Transit (Tier 3) |
| e-CPF dos responsáveis | Assina o Atestado Técnico (PAdES) | Token ou certificado em nuvem do responsável |
| CA interna (step-ca) | Certificados dos aparelhos (mTLS) | VM core |
| Chave do aparelho | Assina cada batida e encadeia a fila local | Chip seguro do aparelho, não exportável |
| Chave de ingestão (par RSA/ECDH, com versão) | Lotes offline: **assina e depois cifra** (AES-256-GCM + chave envelopada) | Pública no aparelho; privada só no rep-core |
| Chaves de dados | Cifram CPF, vetores faciais e fotos em repouso | SOPS / OpenBao |
| WireGuard | Túnel cifrado entre as VMs (recortes de rosto são biometria) | VMs |

**Durabilidade sem réplica (Tiers 1 e 2):**
- **`pg_receivewal` como receptor síncrono** na VM de reconhecimento: o commit só confirma quando o WAL chegou às duas VMs.
- **pgBackRest** envia o WAL continuamente ao S3, com backup completo semanal.
- **Teste de restauração mensal.**

---

## 9. Tiers de infraestrutura e capacidade

**Premissas de cálculo (estimativas):**
- **Pico das 8h:** no pior minuto chegam ~**0,25% dos funcionários por segundo** (1.000 funcionários → ~2,5 batidas/s).
- **Visage:** ~**2,5–3,5 rostos/s por vCPU compartilhada**, derivado de "< 280 ms por rosto no processo total". **[A MEDIR.]**
- **Caminho síncrono na VM core:** ~5–10 ms de CPU por batida (~100 batidas/s); PDF assinado ~20–30/s.

| Tier | Máquinas | Confortável | Limite | Custo estimado |
|---|---|---|---|---|
| **1** | VM core (1 vCPU / 4 GB) + VM reconhecimento (1 vCPU / 4 GB) | ~800–1.000 funcionários | ~1.000–1.400 | ~R$ 90–120/mês (2 VPS de entrada + S3) |
| **2** | VM core + 2 VMs de reconhecimento (a segunda pode ligar só das 7h às 9h) | ~1.500–2.000 | ~2.000–2.800 | ~R$ 130–170/mês |
| **3** | Load balancer + 2 VMs core (2 vCPU / 8 GB) + Postgres primário + réplica síncrona (Patroni) + VM pequena (etcd, Valkey com Sentinel, monitoramento) + N VMs de reconhecimento ou GPU no pico | ~3 mil a 20 mil+ | cresce linear com as engines | ~R$ 600–1.500/mês em VPS |

**Acima do limite**, a válvula do PIN (ver `03-funcionalidades-e-modos.md`, modo degradado) segura o pico sem bloquear ninguém.

**Escala do reconhecimento:**
- A api-coletor reparte entre as engines saudáveis, com um limite de requisições simultâneas.
- Se a espera passar de ~1,5 s, o aparelho cai para PIN + foto.
- Engines extras ligam por agenda no pico.

**Gatilhos para subir de tier:**
- reconhecimento acima de ~60% de CPU no pico;
- tempo para o QR acima de 1,5 s em 5% das batidas;
- cliente que exija garantia de disponibilidade;
- ~3 mil funcionários ou mais.

**Provedor:** os Tiers 1 e 2 cabem em VPS comum (por exemplo Hostinger KVM 1). Cuidados:
- **[A CONFIRMAR]** datacenter no Brasil;
- **WireGuard** entre as VMs, se não houver rede privada;
- medir a vCPU compartilhada no horário real de pico;
- backups sempre no S3, sem depender do provedor.

**Histórico:** a primeira versão desta arquitetura usava 9 serviços gerenciados da AWS. Ela foi descartada por custo e dependência de fornecedor.

---

## 10. Validações técnicas antes de construir o produto

1. **Benchmark da Visage** numa VM de 1 vCPU: rostos/s com prova de vida.
2. **Protótipo api-coletor → entrada → rep-core**, martelado com k6 a 20 batidas/s, conferindo NSR sem buracos e cadeia íntegra.
3. **Leiaute oficial vigente do AFD/AEJ** no gov.br, e se existe validador oficial para rodar no CI.
4. **Assinatura PAdES/CAdES com e-CNPJ A1** no pyHanko, validada no verificador do ITI.
5. **Restauração completa** a partir do S3 + `pg_receivewal`.
