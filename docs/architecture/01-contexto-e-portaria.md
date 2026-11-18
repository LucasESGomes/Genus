# 01 · Contexto, Portaria 671 e proposta do projeto

> Documento 1 de 3 do projeto **REP-P facial da Flauzino** (nome provisório).
> Os outros: `02-arquitetura.md` (como o sistema é construído) e `03-funcionalidades-e-modos.md` (o que ele faz e como cada modo funciona).
>
> **Para quem for revisar:** tudo que está marcado com **[A CONFIRMAR]** é interpretação, estimativa ou fato que ainda não foi verificado na fonte oficial. Os números de artigos foram conferidos no texto compilado da Portaria (versão de 21/07/2026) e no FAQ do MTE, ambos lidos em 22/10/2026.

---

## 1. Resumo em um parágrafo

Um **SaaS de ponto eletrônico do tipo REP-P** (Registrador Eletrônico de Ponto via Programa, Portaria MTP nº 671/2021) com **reconhecimento facial**. Ele roda em **qualquer aparelho que a empresa já tenha** (tablet, celular, PC) e **continua registrando sem internet**. Reaproveita o motor de reconhecimento facial da **Visage**, produto da Flauzino em Python, sem modificar a Visage: o motor é empacotado como um serviço novo. O diferencial para o trabalhador é um **QR Code de recibo** em cada batida, que ele pode conferir depois.

---

## 2. O problema e o público

**Para quem:**
1. **Empresas pequenas e médias** (10 a 200 funcionários) que querem ponto facial **barato e simples**: um aparelho qualquer na parede, sem comprar relógio REP-C (que custa alguns milhares de reais por unidade, mais manutenção e bobina).
2. **Operações sem internet ou com internet instável**: agro, obras, frentes de trabalho. O aparelho registra sem conexão e envia tudo depois, cifrado.

**Dores que o produto ataca:**
- A empresa **não pode obrigar o funcionário a usar o celular pessoal** para bater ponto. Um quiosque compartilhado resolve isso.
- REP-C é caro e preso a um local físico.
- Apps de mercado dependem de conexão, ou do celular de cada funcionário.
- O trabalhador desconfia do registro. O QR verificável dá a ele uma prova independente.

---

## 3. Portaria 671/2021: o que vale para um REP-P

### 3.1 Tipos de sistema (art. 75)

| Tipo | O que é | Exigência principal |
|---|---|---|
| **REP-C** (convencional) | Equipamento físico monolítico | Certificado de conformidade do **Inmetro** + registro no MTE (arts. 76, 90, 92) |
| **REP-A** (alternativo) | Sistema autorizado por acordo/convenção coletiva | Só vale durante a vigência do acordo (art. 77) |
| **REP-P** (programa) | **Software** em servidor dedicado ou nuvem | **Registro no INPI** + requisitos do Anexo IX (arts. 78 e 91) |

O **sistema REP-P** é composto por (art. 75, III):
- o REP-P;
- os **coletores de marcações**;
- o **Armazenamento de Registro de Ponto (ARP)**;
- o **Programa de Tratamento de Registro de Ponto (PTRP)**.

**Coletores** (art. 75, parágrafo único) são "equipamentos, dispositivos físicos ou programas (softwares) capazes de receber e transmitir para o REP-P" as marcações. **Ou seja: a norma já admite qualquer aparelho como coletor.**

### 3.2 Registro, homologação e documentos

| Item | Regra | Fonte |
|---|---|---|
| Homologação no MTE | **Não existe para REP-P.** Precisa apenas do certificado de registro de programa de computador no INPI. | FAQ, pergunta 12 |
| Inmetro / OTC / laudo | **Não se aplica a REP-P** (só ao REP-C). | Arts. 87, 90, 92-A |
| Registro no INPI | Obrigatório (art. 91). O número entra no comprovante, no AFD e no AEJ, só com dígitos (FAQ, pergunta 49). | Art. 91 |
| Atestado Técnico e Termo de Responsabilidade | O fabricante/desenvolvedor entrega a **cada empresa usuária**. PDF com assinatura **PAdES**, assinado pelo **responsável técnico** e pelo **responsável legal**, com certificado ICP-Brasil **de pessoa física** (A1 ou A3, FAQ pergunta 46). **Sem ele, o empregador não pode usar o sistema.** Os signatários respondem civil e criminalmente por declaração falsa. | Art. 89 |
| PTRP | Não precisa de homologação. | FAQ, pergunta 36 |

### 3.3 Assinaturas digitais

- **REP-P e PTRP:** certificados **ICP-Brasil**, como assinatura eletrônica qualificada (art. 88).
- **Comprovante em PDF:** padrão **PAdES** (art. 88, §1º).
- **AFD e AEJ:** padrão **CAdES**, em arquivo **.p7s destacado** (art. 88, §2º; FAQ pergunta 28).
- **Quem assina:**
  - AFD e comprovante: o **fabricante/desenvolvedor**, inclusive quando a empresa usa o próprio REP-P (art. 86, §1º; FAQ perguntas 33 e 44);
  - AEJ: o **desenvolvedor ou o empregador** (art. 86, §2º; FAQ pergunta 34).

### 3.4 Requisitos técnicos do REP-P (Anexo IX, redação da Portaria 1.486/2022)

| Nº | Requisito | Resumo |
|---|---|---|
| 1 | Identificação | Identificar a organização e o trabalhador. |
| 2 | Relógio | Possuir ou acessar relógio sincronizado com a **Hora Legal Brasileira** (Observatório Nacional), com variação máxima de **30 segundos**. |
| 3 | Relógio no coletor | Todo coletor exibe relógio **não analógico com horas, minutos e segundos** no momento da marcação. |
| 4 | Online/offline | As marcações vêm de coletor **on-line**, "podendo **excepcionalmente** estar off-line". |
| 5 | Envio do offline | Registros off-line enviados "no primeiro momento" em que o coletor voltar a ficar on-line, com segurança da informação. |
| 6 | ARP | Armazenamento **redundante, de alta disponibilidade e confiável**. Grava: empregador (6.1), ajuste de relógio (6.2), empregados (6.3), eventos sensíveis (6.4) e marcações (6.5), estas com CPF, data/hora/fuso da marcação, data/hora/fuso da gravação, coletor e hash SHA-256. **Cada estabelecimento tem sua sequência de NSR**, começando em 1. |
| 7 | Imutabilidade | Dados do ARP não podem ser apagados nem alterados, direta ou indiretamente, pelo prazo mínimo legal. |
| 8 | Marcação | Receber **de forma inequívoca** a identificação do trabalhador, com **disponibilidade permanente**. Obter data/hora confiável, gravar no ARP e disponibilizar o comprovante. |
| 9 | Comprovante impresso | Regras de impressão, se for adotado o formato impresso. |
| 10 | Campos da marcação | NSR, CPF, data e hora da marcação (com fuso), data e hora da gravação (com fuso), identificação do coletor, hash SHA-256. |
| 11–12 | AFD | Gerar o AFD a partir do ARP, por intervalo de datas. |
| 13 | Disponibilidade | Todos os equipamentos e programas com **alta disponibilidade**, sem comprometer o registro em nenhuma etapa. |

> **O que "online" significa:** pelo item 4, "on-line" é estar **conectado ao REP-P**, não necessariamente à internet. Um servidor dedicado no local do cliente, com os coletores ligados por rede local, conta como on-line. **[A CONFIRMAR com parecer jurídico.]**
>
> **O offline não é obrigatório** (FAQ, pergunta 52), mas é permitido como exceção.

### 3.5 Comprovante de registro de ponto (arts. 79 e 80)

**Conteúdo mínimo:**
- título "Comprovante de Registro de Ponto do Trabalhador";
- NSR;
- empregador (nome, CNPJ/CPF, CEI/CAEPF/CNO);
- local da prestação do serviço;
- trabalhador (nome e CPF);
- data e hora;
- **número de registro no INPI**;
- **hash SHA-256 da marcação** (exclusivo do REP-P);
- assinatura.

**Formato eletrônico:**
- PDF assinado;
- acesso **após cada marcação**, sem precisar pedir;
- o empregado pode extrair os comprovantes de **pelo menos as últimas 48 horas**.

**Não precisa ser entregue no exato momento da marcação**, desde que o trabalhador tenha acesso eletrônico a ele depois de cada marcação (FAQ, pergunta 40).

### 3.6 AFD (Arquivo Fonte de Dados): art. 81 e leiaute

- Gerado e entregue **prontamente** quando o Auditor-Fiscal pedir (art. 81, §2º). **Pode ser fracionado** (FAQ, pergunta 39).
- O leiaute saiu do Anexo V (revogado) e passou a ser publicado no portal gov.br. **[A CONFIRMAR: os detalhes abaixo vêm do texto do Anexo V que ainda aparece no PDF compilado; conferir a especificação vigente no gov.br.]**
  - **Formato:** texto ISO-8859-1, uma linha por registro, CRC-16 no padrão **CRC-16/KERMIT** (FAQ, pergunta 35).
  - **Nome do arquivo:** `AFD` + nº INPI + CNPJ/CPF do empregador + `REP_P`.
  - **Registro tipo 7 (marcação REP-P):** NSR, tipo, data/hora da marcação, CPF, data/hora da gravação, **identificador do coletor** (01 app mobile, 02 navegador, 03 app desktop, 04 dispositivo eletrônico, 05 outro), **flag on-line (0) ou off-line (1)** e hash.
  - **Hash da marcação:** SHA-256 sobre NSR, tipo, data/hora da marcação, CPF, data/hora da gravação, coletor, flag on/off e **hash do registro anterior**. É uma cadeia.
    **[A CONFIRMAR: se "registro anterior" é qualquer tipo de registro ou só a marcação anterior.]**
  - **Registro tipo 6 (eventos sensíveis):** para REP-P valem **02** (retorno de energia), **07** (disponibilidade de serviço) e **08** (indisponibilidade de serviço).
- **NSR:** sequência própria por CNPJ/CPF de estabelecimento, iniciando em 1 (FAQ, pergunta 41).
- **Fuso horário:** campos de data e hora levam fuso (FAQ, pergunta 53).

### 3.7 PTRP, espelho de ponto e AEJ (arts. 82 a 85)

- **O que o PTRP faz:** trata os dados do AFD e gera o **Espelho de Ponto** e o **AEJ (Arquivo Eletrônico de Jornada)**.
- **O tratamento se limita a acrescentar informações** (omissões, ausências, banco de horas) ou a **indicar marcações indevidas**. Nunca altera a marcação original (art. 82, parágrafo único; FAQ perguntas 55 e 56).
- **Espelho** (art. 84): empregador; trabalhador (nome, CPF, admissão, cargo); período; horário contratual; marcações originais e tratadas; duração das jornadas (inclusive hora noturna reduzida). Acesso **mensal**, no mínimo.
- **AEJ:** leiaute no gov.br, campos separados por `|` (FAQ, pergunta 59). Marcações ímpares no AEJ podem gerar autuação (FAQ, pergunta 56).
- **Prazo:** arquivos e relatórios do PTRP entregues ao Auditor em prazo **mínimo de 2 dias**, a critério dele (art. 85).

### 3.8 Proibições (arts. 74 e 98)

**O sistema não pode ter:**
- restrição de horário para marcar;
- marcação automática;
- exigência de autorização prévia para hora extra;
- qualquer dispositivo que permita **alterar** dados registrados.

Se o Auditor comprovar adulteração, ou "parametrizações e bloqueios na marcação", ele **apreende** documentos, equipamentos e programas (art. 98).

**Consequência de projeto:** o coletor **nunca bloqueia** uma batida. Cerca geográfica, duplicidade e horário viram **sinalização**, nunca impedimento.

### 3.9 LGPD (art. 101)

Empregador e empresas que tratam os dados seguem a Lei 13.709/2018. **Biometria facial é dado pessoal sensível**: exige base legal, RIPD (relatório de impacto), contrato de operador com cada cliente, criptografia e política de retenção.

---

## 4. Critérios indiretos e custos de entrada

| Item | Valor | Observação |
|---|---|---|
| Pedido de registro de programa no INPI (código 730) | **R$ 210**, pago uma vez | Tabela INPI de 20/12/2025. **[A CONFIRMAR] se há desconto para ME.** |
| e-CNPJ A1 ICP-Brasil (assina AFD, comprovante, AEJ) | ~R$ 200–400/ano | Estimativa |
| e-CPF (assina os atestados técnicos) | ~R$ 150–250/ano | Estimativa |
| Parecer trabalhista + LGPD | ~R$ 3–10 mil, uma vez | Recomendado antes de vender |
| Teste de invasão | ~R$ 5–15 mil | Opcional, antes de clientes grandes |
| Enquadramento da empresa | — | **Desenvolvimento de software não é atividade permitida ao MEI.** A Flauzino (hoje MEI) precisa virar ME no Simples Nacional. O imposto fica em ~6% (Anexo III, com Fator R ≥ 28%) ou ~15,5% (Anexo V). **[A CONFIRMAR com contador.]** |

---

## 5. O que o projeto busca ser

### 5.1 Proposta de valor

1. **Qualquer aparelho vira coletor:** tablet Android barato, celular velho, PC com webcam, ou o navegador (só no modo online).
2. **Reconhecimento facial com prova de vida**, reaproveitando o motor da Visage.
3. **Não para quando a internet cai:** o aparelho guarda as batidas e envia sozinho depois.
4. **Modo Campo** para operações sem internet nenhuma: reconhecimento no próprio aparelho, sempre reconferido na nuvem.
5. **QR Code de recibo em toda batida:** o trabalhador confere numa página pública que a batida foi registrada sem alteração.
6. **Preço por funcionário, sem hardware.**

### 5.2 Mercado (o que foi encontrado em 22/10/2026)

Concorrentes **afirmam** (marketing próprio, **não verificado**):
- **Pontotel:** facial offline com prova de vida, marcação pelo navegador, "auditada na Portaria 671".
- **Pontomais (app Ponto REP):** facial e QR em tablet compartilhado, com sincronização offline.
- **Tangerino:** marcação sem internet com envio posterior.

**Conclusão:** "ninguém faz offline" **não** se sustenta. O diferencial está na **combinação**:
- qualquer coletor;
- QR verificável pelo trabalhador;
- modo Campo com reconferência na nuvem;
- preço sem hardware;
- opção futura de servidor no local.

"O mais flexível do mercado" **não é verificável** e não deve ser afirmado publicamente.

### 5.3 Modelo de negócio (premissa de trabalho)

**Tabela de preço proposta:**
- **R$ 79/mês por empresa**, incluindo 10 funcionários;
- por funcionário adicional, em faixas progressivas:

| Faixa | Preço por funcionário |
|---|---|
| 11º ao 50º | R$ 7,90 |
| 51º ao 200º | R$ 6,50 |
| 201º ao 1.000º | R$ 5,00 |
| Acima de 1.000 | R$ 4,00 ou negociado |

- **Extras:** plano Campo por aparelho (R$ 39–59/mês), implantação opcional, desconto anual.

**Meta:** margem mínima de **40%** depois de impostos (~12% somando imposto e taxa de cobrança), suporte (R$ 20 por empresa por mês) e infraestrutura.
- Com a infraestrutura enxuta do Tier 1 (ver `02-arquitetura.md`), o custo fixo fica em ~R$ 1,5 mil/mês.
- Equilíbrio em ~5 empresas de 50 funcionários; 40% de margem em ~9 empresas (~450 funcionários).

**[A CONFIRMAR]:** os preços dos concorrentes ainda não foram pesquisados, e essa tabela pode estar acima ou abaixo do mercado.

---

## 6. Pontos em aberto para parecer jurídico

1. Por quanto tempo uma marcação pode ficar offline antes de deixar de ser "excepcional" (Anexo IX, itens 4 e 5).
2. Se o **QR provisório** cobre o requisito de comprovante "após cada marcação" enquanto o PDF assinado não existe.
3. Se **PIN + foto conferida depois** atende à "identificação inequívoca" (item 8.1).
4. Se **uma única VM com fila e aparelhos que guardam as batidas** atende à "alta disponibilidade" (item 13). O argumento é que o serviço de registro nunca para.
5. Se um **servidor local sem internet**, com o relógio vindo de GPS, atende à sincronização com a HLB (item 2).
6. **Prazo de retenção** do ARP. A premissa é ≥ 5 anos.
7. Base legal e retenção da **biometria** e das **fotos temporárias** (LGPD).

---

## 7. Fontes

- [Portaria MTP nº 671/2021, texto compilado em 21/07/2026 (gov.br)](https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/legislacao/portarias-1/portarias-vigentes-3/WORDPortarian671de8denovembrode2021compilada21.07.2026.pdf)
- [Perguntas e Respostas REP, MTE](https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/fiscalizacao-do-trabalho/Perguntas%20e%20Respostas%20REP)
- [Tabela de retribuições do INPI, programas de computador](https://www.gov.br/inpi/pt-br/servicos/custos-e-pagamento/NovaTabeladeRetribuiesINPI_SOFTWARE_Final_20_dez_25.pdf)
- [Pontotel, biometria facial](https://www.pontotel.com.br/lp/biometria-facial/)
- [App Ponto REP (Pontomais)](https://apps.apple.com/mx/app/ponto-rep/id1521745799)
- [Tangerino Motorista](https://apps.apple.com/us/app/id1553941151)
