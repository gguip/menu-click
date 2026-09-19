# Painel da loja — o que precisa existir

Documento para quem vai desenhar as telas. Descreve **o produto e os estados**,
não a implementação. Tudo aqui está checado contra a API que existe hoje
(`apps/api/openapi.json`, 49 rotas autenticadas).

---

## Quem usa, onde, e em que situação

**O dono e os atendentes de um restaurante pequeno ou médio.** Não é um sistema
de retaguarda que alguém abre de manhã e fecha à noite — é uma tela que fica
**aberta durante o serviço**, num tablet no balcão ou num notebook no caixa,
enquanto a pessoa também atende, embala e cobra.

Isso decide quase tudo do desenho:

- **A tela de pedidos é o produto.** Todo o resto (cardápio, configurações) é
  usado uma vez por semana; pedidos é usado a cada três minutos.
- **Quem olha está de pé, com as mãos ocupadas, e a tela longe.** Alvos grandes,
  contraste alto, texto que se lê a um metro de distância.
- **Errar custa comida.** Confirmar o pedido errado, despachar o que não saiu:
  as ações que mudam estado precisam ser difíceis de tocar por acidente.
- **Pico é barulhento e corrido.** O almoço de sábado é quando o painel precisa
  funcionar, não a terça às 15h.

Dois papéis, e a diferença é pequena de propósito: **`owner`** e **`staff`**
fazem tudo igual, menos duas coisas — administrar usuários e remover o
restaurante, que são só do `owner` (a API responde **403** para `staff`).

---

## O mapa de telas

### Entrada

| Tela | O que faz |
| --- | --- |
| **Login** | e-mail + senha. Devolve um token e a data de expiração |
| **Cadastro** | cria restaurante **e** primeiro usuário numa tela só |
| **Confirme seu e-mail** | 🚨 tela de bloqueio, ver abaixo |
| **Esqueci a senha** | pede o e-mail, e responde sempre a mesma coisa |
| **Nova senha** | chega pelo link do e-mail, com o token na URL |

### Operação (o dia a dia)

| Tela | O que faz |
| --- | --- |
| **Pedidos** | a home. A tela que fica aberta |
| **Detalhe do pedido** | tudo do pedido + os botões que mudam o estado |
| **Resumo do dia** | contadores, faturamento e ticket médio |

### Cardápio (semanal)

| Tela | O que faz |
| --- | --- |
| **Produtos** | grade com busca e filtro por seção |
| **Produto** | criar/editar, incluindo quais grupos de opções ele usa |
| **Seções** | as categorias, e a **ordem** em que aparecem no cardápio |
| **Grupos de opções** | "Sabores", "Adicionais" — e as opções dentro deles |

### Configuração (raro, mas crítico)

| Tela | O que faz |
| --- | --- |
| **Dados da loja** | nome, tipo de cozinha, logo, endereço, fuso |
| **Modalidades e pagamento** | o que a loja aceita |
| **Horário de funcionamento** | a grade da semana |
| **Entrega** | modo de frete, bairros, grátis acima de X, pedido mínimo |
| **Mesas** | cadastro + **o QR code para imprimir** |
| **Usuários** | só `owner` |

---

## Tela por tela

### 🚨 "Confirme seu e-mail" — a tela que não pode faltar

**Loja que não confirmou o e-mail recebe 403 em TODAS as rotas do painel.** Não
é um aviso que dá para dispensar: o painel inteiro não funciona.

Depois do login, `GET /auth/me` devolve `emailVerified: true|false`. Com `false`,
o app não deve nem tentar carregar pedidos — vai levar 403 em tudo.

A tela precisa de:
- Qual endereço recebeu o link (vem do `/auth/me`)
- Um botão **"não recebi, mandar de novo"** — limitado a **3 por minuto**, então
  a tela precisa lidar com **429** e mostrar "aguarde um instante"
- O que fazer se o endereço estiver errado: **não existe caminho pela API**. A
  pessoa espera 7 dias (o cadastro é liberado) ou fala com o suporte. A tela tem
  que dizer isso, e não fingir que há um botão.

⚠️ **Uma incoerência conhecida da API, para não parecer bug:** a listagem
`GET /restaurants` responde **200** para a loja bloqueada, enquanto
`GET /restaurants/:id` responde **403**. É documentado e não é vazamento — mas
o app não deve usar a listagem para decidir se está liberado. Quem decide é o
`emailVerified` do `/auth/me`.

### Pedidos — a tela que fica aberta

O coração do painel. Precisa responder três perguntas, na ordem:

1. **Chegou pedido novo?**
2. **O que eu preciso fazer agora?**
3. Como está o dia?

**Um pedido novo tem que se anunciar sozinho** — som, badge, a linha aparecendo
com destaque. Ninguém vai apertar F5. (Hoje a API não empurra nada e o app
consulta de tempos em tempos; um canal em tempo real está sendo construído. O
desenho deve assumir que a lista se atualiza sozinha, seja como for.)

**A organização natural é por status**, não uma lista cronológica única — porque
cada status corresponde a uma ação física diferente:

```
Novos          → aceitar ou recusar
Em preparo     → a cozinha está fazendo
Prontos        → esperando sair / esperando o cliente
Finalizados    → histórico do dia
```

⚠️ **As colunas mudam conforme a modalidade**, e isso não é detalhe: entrega
passa por "saiu para entrega", retirada por "pronto para retirada", e salão vai
de "em preparo" direto para "concluído". Uma coluna "saiu para entrega" com um
pedido de mesa dentro é um erro de leitura.

Cada cartão de pedido mostra:

| Campo | Vem de |
| --- | --- |
| Nome e telefone do cliente | `customer.name`, `customer.phone` |
| Modalidade | `type` — e é ela que decide o ícone e o vocabulário |
| **A mesa**, em pedido de salão | `table.label` — pode ser `null` |
| Total | `totalInCents` |
| Forma de pagamento, e o troco | `paymentMethod`, `changeForInCents` |
| Há quanto tempo chegou | `createdAt` |

**Filtros que a API oferece:** status, mesa (`tableId`), período
(`hoje`, `ontem`, `últimos 7 dias`, `este mês`) ou intervalo de datas, e
ordenação por data ou valor. ⚠️ Período e intervalo de datas **não se
combinam** — mandar os dois é erro. A tela precisa escolher um ou outro, nunca
os dois ligados ao mesmo tempo.

### Detalhe do pedido

O que a lista não mostra: **os itens**, com as opções escolhidas de cada um.

```
2× Pizza Grande                      R$ 80,00
   Sabores: Calabresa, Portuguesa
   Borda: Catupiry                   (+R$ 8,00)
1× Coca 2L                           R$ 12,00
                        Frete        R$  9,00
                        TOTAL        R$ 101,00
```

⚠️ **O frete precisa aparecer na conta.** Em pedido de entrega,
`totalInCents` **já inclui** o frete — se a tela listar só os itens e mostrar o
total, a conta não fecha e quem confere lê como erro. `deliveryFeeInCents` tem
três significados distintos: um valor (o frete), `0` (entrega grátis) e `null`
("a combinar", ou não é entrega). Os três precisam de textos diferentes.

**Os botões são a máquina de status**, e só aparece o que é possível agora:

```
entrega    Novo → Aceitar → Preparando → Saiu para entrega → Concluído
retirada   Novo → Aceitar → Preparando → Pronto            → Concluído
salão      Novo → Aceitar → Preparando →                      Concluído
                            Cancelar, enquanto não terminou
```

⚠️ **Aceitar é irreversível e baixa o estoque.** Não há "desconfirmar". Merece
confirmação, e o botão não pode ficar onde o polegar encosta sem querer.

⚠️ **Cancelar devolve estoque — mas só até a comida ficar pronta.** Depois de
"saiu para entrega" ou "pronto", as unidades não voltam. Se a tela disser
"cancelar" com o mesmo texto nos dois casos, o dono vai achar que o estoque
voltou quando não voltou.

### Resumo do dia

Contadores por status, **faturamento**, quantos pedidos o compõem e o **ticket
médio** — para o período escolhido.

Duas coisas para o texto não mentir:

- **Faturamento conta de "aceito" em diante.** Pedido novo ainda não é venda, e
  cancelado deixou de ser. Se a tela chamar isso de "vendas de hoje", está certo;
  se disser "tudo que entrou", está errado.
- ⚠️ **O faturamento inclui o frete.** R$ 30 de comida + R$ 15 de entrega entram
  como R$ 45. É o que a loja cobrou, então para faturamento bruto está certo —
  mas o ticket médio mistura comida com entrega, e a tela não deveria sugerir
  que aquele número serve para decidir preço de cardápio.

### Produtos

Grade com **busca por nome** e **filtro por seção**. Paginada.

Cada produto tem nome, preço, descrição, foto (**hoje é uma URL que a pessoa
cola** — não há upload ainda), **estoque** e a seção.

⚠️ **O estoque só aparece aqui, nunca para o cliente.** No cardápio público o
cliente vê apenas "disponível ou não". Isso é deliberado.

### Produto (criar / editar)

Além dos campos, a parte que merece desenho: **quais grupos de opções este
produto usa**, e **em que ordem** aparecem para o cliente. É uma seleção
ordenável a partir dos grupos já cadastrados na loja — não se cria grupo aqui.

### Seções (categorias)

Lista **reordenável** — a ordem é a da refeição (Entradas, Pratos, Sobremesas),
não alfabética, e é ela que o cliente vê.

⚠️ **Remover uma seção não remove os produtos dela** — eles caem num grupo
"Sem categoria" no fim do cardápio. A confirmação deve dizer isso, senão parece
que apagar a seção apaga a comida.

Nome repetido é recusado, inclusive com caixa diferente: com "Bebidas" já
criada, "bebidas" dá erro.

### Grupos de opções

O nível que faz o sistema vender pizza e hambúrguer com adicional.

Um grupo pertence à **loja**, não ao produto — "Sabores" serve todas as pizzas.
Cada grupo tem: nome, mínimo e máximo de escolhas, e **a regra de preço**:

| Regra | O que faz | Quando usar |
| --- | --- | --- |
| **Somar** | soma tudo | adicionais, bacon, borda |
| **Mais caro** | cobra só a opção mais cara | pizza meio a meio |
| **Média** | média das escolhidas | a outra convenção de meio a meio |

Essas três precisam ser **explicadas na tela com um exemplo em reais**, não só
nomeadas. A diferença entre elas é o preço final da pizza, e quem cadastra não
vai deduzir do nome.

Dentro do grupo, cada opção tem nome, preço e quantidade máxima.

### Mesas — e o QR code

Cadastro simples (só um rótulo: "Mesa 7", "Varanda 2"), mas a tela tem um
propósito físico: **imprimir o adesivo**.

Cada mesa vem da API com uma **URL pronta** (`qrUrl`). O front desenha o QR a
partir dela e mais nada.

O que a tela precisa oferecer:
- **Imprimir**, de preferência várias mesas de uma vez, numa folha
- Um botão de **gerar novo código**, que **invalida o adesivo atual na hora** —
  precisa de confirmação forte, porque quem apertar sem entender vai ter mesas
  com QR que não abre
- Deixar claro que **renomear a mesa NÃO invalida o QR** (é seguro renomear)

Sugestão para o material impresso: erro de leitura em nível médio ou alto, não o
padrão — o adesivo vai pegar gordura, risco e luz ruim.

### Entrega

A tela com mais regra escondida:

- **Modo do frete**: por bairro (com uma lista de bairros e o preço de cada um)
  ou taxa fixa. *Por distância existe no banco mas ainda não pode ser escolhido.*
- **Grátis acima de X** — compara com o valor dos **itens**, sem o frete
- **Pedido mínimo** — só vale em entrega; zero significa "sem mínimo"
- **"A combinar"** — o que fazer quando não dá para calcular

⚠️ **Não configurar não é frete grátis.** Modo bairro sem nenhum bairro
cadastrado significa "não consigo calcular", e a loja **recusa o pedido** (ou
aceita com frete a combinar, se a chave estiver ligada). A tela precisa avisar
disso de forma bem visível, porque o erro silencioso aqui é entregar de graça
para a cidade inteira.

### Horário de funcionamento

Grade da semana, e **um dia pode ter mais de uma faixa** — é assim que se
declara "fecha entre o almoço e o jantar". **Dia sem faixa nenhuma é dia
fechado**; não existe um botão "fechado".

⚠️ **Fechar depois da meia-noite é normal, não erro.** Uma faixa 18:00–02:00 é a
pizzaria que atende até as duas. A tela não pode tratar "hora final menor que a
inicial" como inválido.

Separado da grade, a **pausa manual**: um interruptor de "parar de aceitar
pedidos agora" que **não mexe no horário cadastrado**. É o botão de "a cozinha
está afogada" — e a loja precisa vê-lo do jeito mais direto possível, de
qualquer tela, porque é o que se usa no meio do pico.

### Usuários

Só `owner`. Criar, listar e remover. Sem papel informado, o usuário nasce
`staff`.

⚠️ **Ninguém remove a si mesmo** — a API recusa. A tela não deve oferecer o
botão na própria linha.

---

## Estados que precisam de desenho, e quase sempre são esquecidos

| Estado | Onde aparece |
| --- | --- |
| **Loja não verificada** | bloqueia o painel inteiro |
| **`staff` tentando ação de `owner`** | usuários, remover a loja |
| **Nenhum pedido ainda** | é o primeiro dia da loja |
| **Cardápio vazio** | precisa empurrar para "criar a primeira seção" |
| **Sessão expirada** | o token tem validade; qualquer tela pode virar 401 |
| **Limite de requisições (429)** | reenvio de e-mail, e o login |
| **Sem internet no meio do serviço** | o pior momento possível |
| **Nome repetido** | seção, mesa |
| **Estoque acabou ao aceitar** | o pedido é recusado na hora de aceitar |

---

## O que a API **não** oferece, para não desenhar no vazio

- **Upload de imagem** — logo e foto de produto são URLs que a pessoa cola
- **Impressão de comanda / integração com impressora térmica**
- **Relatório histórico** além dos contadores do período
- **Conta aberta por mesa** — cada pedido da mesa é independente
- **Chamar o garçom**, chat com o cliente, cancelamento pelo cliente
- **Notificação push / app nativo**

---

## Sugestão de fatiamento

**v1 — o que faz a loja operar:** login, a tela de verificação de e-mail,
pedidos com atualização automática, detalhe do pedido com as transições,
produtos e seções.

**v2 — o que a loja configura uma vez:** grupos de opções, horário, entrega,
modalidades e pagamento, dados da loja.

**v3:** mesas com impressão de QR, usuários, resumo do dia.

O corte é por frequência de uso, não por dificuldade: v1 é o que se toca todo
dia, v3 é o que se toca uma vez por mês.
