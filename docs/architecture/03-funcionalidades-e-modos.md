# 03 · Funcionalidades, modos de operação e APIs

> Documento 3 de 3. Contexto legal em `01-contexto-e-portaria.md`; arquitetura em `02-arquitetura.md`.
>
> **Para quem for revisar:** os fluxos abaixo são a especificação funcional pretendida. Nada foi implementado ainda.

---

## 1. Personas

| Persona | Onde interage | O que faz |
|---|---|---|
| **Trabalhador** | Aparelho coletor, página do QR, portal do trabalhador | Bate ponto, confere o recibo, baixa comprovantes, vê o espelho, contesta |
| **RH / gestor** | Portal de RH | Cadastra empresa, estabelecimentos, funcionários e aparelhos; trata o ponto; fecha o mês |
| **Auditor-Fiscal** | Recebe arquivos via RH (modo fiscalização) | Pede AFD, AEJ, espelho e atestado técnico |
| **Flauzino (operação)** | Painel interno e alertas | Monitora filas, falhas, divergências de rosto, saúde das VMs |

---

## 2. Preparação

### 2.1 Instalar um aparelho (provisionamento)

1. No portal, o RH clica em **"Novo aparelho"** e recebe um **QR Code de uso único** (válido por 15 min), ligado ao estabelecimento.
2. O app lê o QR e **gera um par de chaves no chip seguro** do aparelho.
3. `POST /provisionar` (api-coletor) com o código. O step-ca emite o **certificado do aparelho**, usado no mTLS.
4. O aparelho recebe:
   - estabelecimento e fuso;
   - **hora assinada**;
   - chave pública de ingestão;
   - lista de funcionários (CPF, nome, PIN cifrado, sem biometria);
   - no modo Campo, também o modelo reduzido e a galeria facial cifrada.
5. O aparelho entra em **modo quiosque** e mostra o relógio com segundos (Anexo IX, item 3).

O RH pode **revogar** um aparelho a qualquer momento: o certificado é revogado e a galeria local é apagada remotamente.

### 2.2 Cadastrar funcionário e rosto

1. O RH cadastra o funcionário no portal. O `app` guarda o estado atual, e o rep-core grava o **registro tipo 5** no ARP.
2. **Cadastro facial:** no próprio quiosque (com prova de vida) ou por foto enviada no portal → `POST /cadastrar` no face-engine → vetor guardado **cifrado** no `app`.
3. Um evento faz as engines recarregarem a galeria daquele estabelecimento.
4. **Consentimento e transparência (LGPD):** registro da ciência do trabalhador. Base legal e texto: **[A CONFIRMAR com o parecer]**.
5. O funcionário recebe um **PIN** (ou crachá com QR), usado nos modos alternativos.

---

## 3. Os quatro modos do coletor

O aparelho escolhe o modo **sozinho**, conforme a conexão e a resposta do servidor. O funcionário nunca fica sem bater ponto.

| Modo | Quando | Como identifica | NSR sai | Recibo na hora |
|---|---|---|---|---|
| **1. Online** | Servidor respondendo bem | Rosto na nuvem (1:N + prova de vida) | Em segundos | QR, que vira oficial logo |
| **2. Degradado** | Online, mas o reconhecimento passou de ~1,5 s ou falhou | **PIN/crachá + foto**; rosto conferido depois (1:1) | Em segundos | QR |
| **3. Offline parcial** | Sem internet ou servidor fora; **qualquer aparelho** | PIN/crachá + foto | Quando a conexão volta | QR provisório |
| **4. Campo** | Sem internet; aparelho com o módulo local (plano Campo) | Rosto **no próprio aparelho**; reconferido na nuvem | Quando a conexão volta | QR provisório |

### 3.1 Modo 1: Online

1. **Aparelho:** detecta o rosto, confere nitidez e luz, captura 2–3 recortes. Monta a batida com a **sequência local** (ex.: 812) e a hora corrigida. **Assina com a chave do chip** e **grava no banco local antes de enviar**.
2. `POST /coletor/batidas` → nginx (mTLS) → **api-coletor**: confere a assinatura e se o aparelho está ativo.
3. **① api-coletor → face-engine** `POST /identificar` (timeout ~800 ms): "CPF da Maria, vida ok, nota 0,97".
4. **② COMMIT** na tabela `entrada` (status `pendente`).
5. **③ Publica** na `fila batidas` (jobId = aparelho + 812) e responde ao aparelho: **"Maria, registrado"** + QR (ID do recibo). Tempo total ≈ 1 s.
6. **④ rep-core consome** e **⑤ grava, numa transação:** NSR + hash em `registros`, `entrada` = `processado`, eventos no `outbox`.
7. **⑥ Publica** na `fila pós-batida` → **⑦ jobs**:
   - PDF do comprovante assinado (signer) → S3;
   - jornada do dia (PTRP);
   - QR marcado como **Oficial (NSR 18.432)**.
8. **Aparelho:** recebe a confirmação com o NSR na próxima conversa com o servidor e **mantém a cópia local por 7 dias**.

### 3.2 Modo 2: Degradado (a válvula do pico)

1. No passo 3, a espera passa de ~1,5 s ou o face-engine falha. A api-coletor responde **"identificação alternativa"**.
2. O aparelho pede **PIN ou crachá** e tira uma **foto**.
3. Com o CPF já conhecido, a batida segue os passos 4 a 7 normalmente (NSR em segundos), com o método de identificação registrado em `evidencias`.
4. A foto vai ao S3 (pasta temporária) e gera o job **"verificar foto"**: o face-engine compara 1:1 com o vetor do CPF, **fora do pico**.
   - **Bateu:** a foto é apagada.
   - **Não bateu:** alerta para o RH. **A batida no ARP nunca é alterada**; se for fraude, o PTRP a marca como indevida.

### 3.3 Modo 3: Offline parcial (qualquer aparelho, sem ML local)

**Na batida:**
1. O aparelho não alcança o servidor e muda a tela: **"Digite seu PIN ou aproxime o crachá"**.
2. Confere o PIN na **lista local**, tira uma foto e calcula a hora:
   - hora assinada + relógio monotônico;
   - se o aparelho reiniciou, hora do GNSS;
   - se não houver nenhuma, hora do sistema com a marca "não confiável".
3. Monta a batida (sequência 813), **encadeia com o hash da 812**, assina e guarda cifrada.
4. Mostra o **QR provisório** (aparelho, sequência, hora, CPF mascarado, hash do aparelho).

**Na volta da conexão (automático, sem ninguém apertar nada):**
1. Monta o **lote**: batidas + fotos, **assinado e depois cifrado** com a chave pública de ingestão.
2. `POST /coletor/lotes` → a api-coletor **não abre o lote**: salva o arquivo bruto no S3, grava na `entrada` e publica → responde "recebido".
3. O **rep-core** abre o lote e confere:
   - a assinatura de cada batida;
   - a **continuidade da cadeia do aparelho** (lacuna de sequência → alerta).
4. Cada batida passa pela transação do NSR com **flag off-line = 1**, guardando a hora da marcação (do aparelho) e a hora da gravação (agora).
5. Fotos → job "verificar foto", como no modo 2.
6. O aparelho recebe "813 → NSR 18.501, 814 → NSR 18.502…" e os QRs passam a aparecer como **Oficial**.

### 3.4 Modo 4: Campo (reconhecimento no aparelho)

Igual ao modo 3, com três diferenças:
1. O aparelho tem o **modelo reduzido da Visage** e a **galeria cifrada só do seu estabelecimento**. **Reconhece sem PIN.**
2. Cada batida leva o **recorte do rosto** e a nota local.
3. Na sincronização, a nuvem **reconhece de novo** com o modelo completo. Se discordar, gera alerta. **A palavra final é sempre da nuvem.** Depois disso, o recorte é descartado.

**Futuro (opcional):** envio por outra pessoa. O celular de um supervisor ou motorista recebe o lote por Bluetooth ou Wi-Fi local e envia quando tiver sinal. Ele não consegue ler nem alterar o lote, que está assinado e cifrado. Também é uma opção futura o **servidor local** (mini-PC no estabelecimento) para operações sem internet nenhuma; ver `01`, seção 6.

### 3.5 Queda da nuvem

1. Os aparelhos entram no modo 3 ou 4 sozinhos. Nenhuma batida se perde.
2. O monitor registra início e fim da indisponibilidade.
3. Na volta, o rep-core grava em cada estabelecimento o **evento 08** (indisponível, com a hora de início) e o **07** (disponível), e processa os lotes acumulados. O resgate republica o que ficou `pendente`.

---

## 4. O QR Code de recibo

- **Conteúdo:** link de verificação com ID do recibo, data e hora, estabelecimento, **CPF mascarado** e hash. No offline, o hash é o do aparelho, com a assinatura dele.
- **Página pública `GET /v/{id}`:** mostra **Oficial** (NSR + hash da Portaria), **Processando / aguardando sincronização** ou **Divergente**. Não mostra dados pessoais completos. Cache curto na Cloudflare.
- **PDF oficial:** só no portal do trabalhador, com login.
- **Natureza jurídica:** é um recibo **adicional**. O comprovante legal é o PDF assinado (arts. 79 e 80). **[A CONFIRMAR]:** se o QR provisório cobre o intervalo offline.
- **Não enviar por WhatsApp a cada batida:** o custo por mensagem inviabiliza. No máximo, um resumo periódico.

---

## 5. Regras de UX que vêm da Portaria

- **Nunca bloquear** (art. 74):
  - batida repetida → avisa ("você já bateu às 07:58") e **deixa registrar**;
  - fora do horário ou fora da cerca geográfica → **sinaliza**, não impede.
- **Sem marcação automática** e **sem autorização prévia para hora extra**.
- **Nenhuma tela edita uma batida.** O RH só **acrescenta** (justificativa, abono, pré-assinalação do intervalo) ou **marca como indevida** no PTRP.
- Relógio com **hora, minuto e segundo** sempre visível no coletor.

---

## 6. Portais

### 6.1 Portal de RH

- **Cadastros:** empresa/empregador (gera tipo 2 no ARP), estabelecimentos, funcionários (gera tipo 5), horários contratuais e intervalos, aparelhos (provisionar e revogar).
- **Tratamento de ponto (PTRP):** jornadas calculadas, faltas, horas extras, banco de horas, hora noturna reduzida, justificativas e abonos, marcações indevidas.
- **Fechamento do mês:** espelho de ponto (art. 84) para todos, publicado no portal do trabalhador.
- **Alertas:** divergência de rosto, lacunas de sequência de aparelho, aparelho sem sincronizar há muito tempo.
- **Modo fiscalização:**
  - **AFD** por estabelecimento e período, gerado em segundos e assinado (.p7s);
  - **AEJ** assinado;
  - espelhos;
  - **Atestado Técnico e Termo de Responsabilidade** (PDF PAdES) para download.

### 6.2 Portal do trabalhador

- Comprovantes de cada batida (PDF assinado), **no mínimo das últimas 48 h** (todos ficam guardados).
- Espelho de ponto mensal.
- **Contestação** de marcação/jornada para o RH.
- Verificação dos próprios recibos QR.

---

## 7. Mapa de APIs

### 7.1 api-coletor (pública, mTLS)

| Método e rota | Função |
|---|---|
| `POST /coletor/provisionar` | Instala o aparelho com o código de uso único; devolve certificado e configuração |
| `GET /coletor/config` | Funcionários do estabelecimento, parâmetros, galeria (modo Campo), chave de ingestão |
| `GET /coletor/hora` | Hora assinada pelo servidor |
| `POST /coletor/batidas` | Batida online (recortes do rosto, ou PIN + foto no modo degradado) |
| `POST /coletor/lotes` | Lote offline cifrado |
| `GET /coletor/confirmacoes?desde=` | Lista sequência → NSR / hash das batidas já gravadas |

### 7.2 api-portal (pública, login)

- **Páginas e rotas de RH:** cadastros, tratamento, fechamento, alertas, modo fiscalização.
- **Rotas do trabalhador:** comprovantes, espelho, contestação.
- **Página pública:** `GET /v/{id}`.

### 7.3 rep-core (via `/fiscal`, login de RH)

| Método e rota | Função |
|---|---|
| `GET /fiscal/afd?estabelecimento=&inicio=&fim=` | AFD + .p7s |

### 7.4 Internas (sem acesso externo)

| Serviço | Rota | Função |
|---|---|---|
| face-engine | `POST /identificar` | 1:N na galeria do estabelecimento + prova de vida |
| face-engine | `POST /verificar` | 1:1 (foto do modo degradado/offline, recorte do modo Campo) |
| face-engine | `POST /cadastrar` | Gera o vetor de um rosto novo |
| signer | `POST /assinar/pdf` | Comprovante, espelho, atestado (PAdES) |
| signer | `POST /assinar/cades` | AFD e AEJ (.p7s destacado) |

---

## 8. Jobs e rotinas

| Job | Gatilho | O que faz |
|---|---|---|
| `gerar_pdf` | Evento pós-batida | Monta o comprovante (art. 79), assina e salva no S3 |
| `calcular_jornada` | Evento pós-batida | Recalcula o dia do funcionário (PTRP) |
| `qr_oficial` | Evento pós-batida | Marca o recibo como oficial |
| `verificar_foto` | Batida por PIN ou modo Campo | Confere o rosto 1:1; alerta se divergir; apaga a foto |
| `espelho_mensal` | Agendado (fechamento) | Gera os espelhos do mês |
| `selo_worm` | Diário | Último NSR + hash + total por estabelecimento → bucket WORM |
| `conferir_cadeias` | Diário | Recalcula as cadeias de hash do dia; alerta se não fecharem |
| `limpar_fotos` | Diário | Apaga fotos já conferidas (e qualquer uma com mais de 7 dias) |
| `resgate` | A cada 15–30 s | Republica eventos `pendentes` há mais de 30 s |
| `eventos_07_08` | Volta de indisponibilidade | Grava os eventos sensíveis em cada estabelecimento |

---

## 9. Planos comerciais (premissa)

- **Base:** R$ 79/mês por empresa (até 10 funcionários) + preço por funcionário em faixas progressivas (detalhes em `01`, seção 5.3).
- **Plano Campo:** adicional por aparelho com o módulo local de reconhecimento e o envio por outra pessoa (quando existir).
- **Implantação:** opcional (cadastro facial em massa, configuração).
