# Mesas e o QR code do salão — desenho

**Data:** 2026-09-15 · **Estado:** implementado (PR `feat/mesas-e-qrcode`)

## O problema

O produto se chama "cardápio digital, **QR code** e delivery", e a modalidade
que dá nome a ele não opera.

`dine_in` existe desde a migration `add-order-type-and-status` e percorre a
máquina de status inteira. Mas **nada no pedido diz de qual mesa ele veio**. O
`slug` é um só por restaurante, então o QR da mesa 3 e o da mesa 12 abrem
exatamente a mesma URL. Na prática, o pedido chega ao painel com o nome e o
telefone de quem pediu, e o garçom sai procurando "João, 11 9xxxx" pelo salão.

Isso não é um `if` faltando — é um conceito que não existe no domínio. Não há
tabela de mesas, não há coluna, não há parâmetro no cardápio público.

Medido antes de começar: das três modalidades, entrega e retirada operam de
ponta a ponta hoje; salão é a única que não fecha.

## As decisões que já foram tomadas

| Decisão | Escolha |
| --- | --- |
| O que a mesa é | **cadastro próprio**, com hash e QR por mesa |
| O que a mesa faz | **só identifica** — sem conta aberta, sem estado |
| Quem gera o QR | **o front**; a API devolve a URL pronta |
| O hash no banco | **em claro**, e rotacionável |
| Formato da URL | `MENU_BASE_URL/<slug>?mesa=<hash>` |
| Mesa no pedido | **opcional**, para não quebrar QR já impresso |
| Cliente na mesa acompanha o pedido? | **não** — segue sem `trackingToken` |

## Arquitetura

### A mesa só identifica; conta aberta é outro produto

Se a mesa 7 pedir uma entrada e, vinte minutos depois, a sobremesa, o painel
mostra **dois pedidos independentes etiquetados "Mesa 7"**, cada um com a
trilha de status que já existia. Não há `table_sessions`, não há abrir/fechar
conta, não há taxa de serviço.

Conta aberta exigiria uma segunda máquina de estado convivendo com a do pedido,
rotas de abertura e fechamento, e uma decisão sobre taxa de serviço que ninguém
tomou. O que este desenho garante é **não fechar a porta**: acrescentá-la
depois é uma coluna a mais em `orders`, não uma reescrita.

### O hash fica em claro, e isso não afrouxa o S21

`sessions` e o `trackingToken` guardam só o `sha256` porque são **segredos
entregues uma vez a uma pessoa**. O hash da mesa é o oposto em todas as
dimensões que decidem:

| | hash da mesa | `trackingToken` |
| --- | --- | --- |
| Identifica | um objeto físico | um pedido |
| Vida útil | anos | horas |
| Onde fica | impresso, colado na parede | na tela de quem pediu, uma vez |
| Quem enxerga | qualquer um que entre no salão | só quem fez o pedido |
| O que libera | nada — só etiqueta o pedido | **ler** o pedido inteiro |
| Reimprimir | é requisito | nunca |

E os dois **nunca coexistem**: `dine_in` não emite `trackingToken`,
`delivery`/`takeaway` não têm mesa. São fluxos disjuntos, então a mesa é
categoria nova e não herda a regra.

Guardar só o hash tornaria **reimprimir impossível** — o valor original não
existiria em lugar nenhum, e trocar de adesivo viraria o caminho normal em vez
da exceção. O que protege a mesa é **entropia** (16 bytes, 128 bits) mais a
**rotação**, não sigilo.

⚠️ Por isso o gerador mora em `domain/table.ts` e **não** em `tokens.ts`.
Aquele arquivo se abre prometendo "o valor vai para o cliente uma vez, e o
banco guarda só o hash". As duas metades são falsas para a mesa; enfiá-la lá
obrigaria a afrouxar a promessa, abrindo a porta para alguém guardar um segredo
de verdade em claro "seguindo o exemplo da mesa".

São **16 bytes e não os 32 de `tokens.ts`** porque o critério é outro: lá o
tamanho vem de "isto protege o dado de alguém"; aqui, de "isto é impresso, e
cada caractere adensa o QR" — e QR denso escaneia pior de longe e com luz ruim,
que é a condição real de um salão.

### A rotação é rota própria; o PATCH não toca no hash

`POST /restaurants/:restaurantId/tables/:id/rotate-hash` sorteia um hash novo e
mata o adesivo anterior no instante do commit.

É rota separada porque o efeito é **físico**. Renomear "Mesa 7" para "Mesa 8"
não pode, como efeito colateral, invalidar o QR colado nela — o mesmo
raciocínio que mantém o `slug` fora do `PATCH` do restaurante.

### A URL: slug no caminho, hash na querystring

```
MENU_BASE_URL/<slug>?mesa=<hash>
```

O servidor monta a URL inteira e a devolve em `qrUrl`. O front fica reduzido a
`<QRCode value={table.qrUrl} />`: tanto `react-qr-code` quanto `qrcode.react`
têm `value: string` como **única** prop obrigatória.

A alternativa era uma URL auto-contida (`/m/<hash>`), resolvida por uma rota
que devolvesse o cardápio inteiro. Ela economiza treze caracteres — medido, a
diferença é versão 5 contra versão 4 do QR, irrelevante na hora de escanear — e
custa **um segundo cardápio público** para manter em sincronia campo a campo
com o primeiro. Este repositório já tem cicatriz de duas listas que deviam
concordar e divergiram; não vale.

Fica, então, uma rota pública minúscula só para a resolução:

```
GET /menu/:slug/table/:hash  →  200 { "label": "Mesa 7" }  |  404
```

Ela existe para a tela dizer *"você está na Mesa 7"*. Sem isso, quem escaneou o
adesivo errado só descobre quando a comida for para outra mesa.

⚠️ Devolve **só o rótulo** — nem `id`, nem `hash`. Devolver o hash entregaria a
credencial do adesivo a quem passe pela mesa. O hash sai, sim, nas rotas de
**gestão**: lá quem lê é o dono do salão, que precisa dele para imprimir.

### `MENU_BASE_URL` derruba o boot se faltar

Mais duro que o precedente das URLs de e-mail, que só derrubam o boot com
`EMAIL_DRIVER=smtp`. A diferença é o custo do erro: um link de e-mail errado se
conserta com um reenvio; uma URL de QR errada **já foi impressa, plastificada e
colada em quarenta mesas** antes de alguém escanear a primeira, e desfazer é
trabalho físico.

A URL precisa ser **parseável**, não só existir — mesma checagem da `SMTP_URL`,
e pelo mesmo motivo: uma base malformada só apareceria como QR que não abre,
muito depois de colado.

### 🚨 `tableHash` é opcional, e essa é a garantia mais frágil

Todo QR code impresso antes desta feature aponta para `/slug` **sem hash
nenhum**, porque mesa não existia quando ele foi colado. Se `tableHash` fosse
obrigatório, no deploy **todo adesivo já colado pararia de funcionar**: o
cliente escaneia, monta o carrinho e leva erro no fim. É exatamente o dano que
o projeto evita ao proibir editar o `slug` por `PATCH`, chegando pela porta dos
fundos.

E aqui **não existe backfill honesto**. A grade de horário pôde ser salva com
24x7 porque aquilo *preservava fielmente* o comportamento anterior; inventar
uma "Mesa 1" por loja não preservaria nada, já que o adesivo impresso
continuaria sem o hash dela.

Então pedido de salão sem mesa continua válido e significa o que sempre
significou: alguém no salão pediu, sem dizer de onde.

**Custo assumido:** enquanto houver adesivo velho colado, o painel terá pedidos
de salão sem mesa, e não dá para distinguir "adesivo antigo" de "abriu o
cardápio direto". Se isso incomodar, a saída é uma flag `requiresTable` que a
loja liga **depois** de trocar os adesivos — aditiva, não quebra ninguém. Fora
de escopo: ninguém pediu.

### O pedido congela o rótulo

`orders` ganha `table_id` **e** `table_label`. A segunda não é redundante com o
join: é a mesma disciplina de `order_items` copiar nome e preço do produto.
Renomear a mesa não reescreve o histórico, remover a mesa não apaga o rótulo do
pedido, e **nenhuma leitura de pedido junta `tables`**.

O `check` `orders_table_check` exige as duas colunas juntas e só em `dine_in` —
espelha o `orders_address_check`.

### Os status code, e por que eles diferem entre as duas superfícies

| Situação | Resposta |
| --- | --- |
| `tableHash` inválido **na criação do pedido** | **400** |
| hash inválido **na resolução pública** | **404** |

Na criação é a **montagem do pedido** que falha, não um recurso ausente — a
mesma categoria das violações de opção, que o `CLAUDE.md` já classifica assim.
Vale para mesa de outro restaurante, hash inexistente e hash já rotacionado.

Na resolução pública tudo é 404, **inclusive hash malformado**: ali "não
existe" e "não poderia existir" têm que ser indistinguíveis. Por isso o schema
daquela rota **não tem `pattern`** apesar de o hash ter forma conhecida — um
`pattern` faria formato errado sair 400, denunciando que aquele formato chegou
a ser avaliado. É o D14 aplicado (id fora do formato responde 404, não 400).

### Quem está na mesa continua sem acompanhar

`dine_in` não recebe `trackingToken` — `acompanhaPedido()` em `domain/order.ts`
é `return type !== "dine_in"`. A pessoa pede e descobre quando a comida chega.

Isso é **consequência do modelo**, não um `if` removível: sem credencial
emitida, não existe com o que conectar ao canal.

### Nenhuma rota de mesa é `ownerOnly`

O papel restringe só o que é destrutivo (apagar o negócio, administrar
usuários). Gerenciar mesa é operação de salão, como mexer no cardápio: `staff`
faz. Marcar a rota nova como `ownerOnly` por reflexo criaria uma hierarquia que
ninguém decidiu.

## 🚨 Todas as superfícies que isto toca

| Superfície | O que muda |
| --- | --- |
| `POST/GET/PATCH/DELETE /restaurants/:restaurantId/tables` | **novas** |
| `POST .../tables/:id/rotate-hash` | **nova** |
| `GET /menu/:slug/table/:hash` | **nova, pública** |
| `POST .../orders` | aceita `tableHash`; resolve, valida e congela |
| `GET .../orders/:orderId` | ganha `table: { id, label } \| null` |
| `GET .../orders` (listagem) | idem, **e** o filtro `?tableId=` |
| `GET /orders/:orderId?token=` (recibo) | **nada** — schema próprio, e `dine_in` não tem token |
| WebSocket `/track` | **nada** — não há token em `dine_in` |
| `GET .../orders/summary` | **nada** |
| `GET /menu/:slug` | **nada** — `MenuRestaurant` não é tocado |
| `remove()` de restaurante | cascata do D3 passa a marcar as mesas |
| `openapi.json` | regerado; tag "Mesas" declarada |
| `seed.sql` | o Tokyo (o `is_qrcode`) ganha três mesas com hash fixo |
| `.env.example` | `MENU_BASE_URL` |

## Testes

O que mais importa é o menos óbvio: **pedido de salão sem `tableHash` continua
sendo aceito**. É a garantia que some primeiro numa refatoração que "limpa" a
opcionalidade, e ela protege todo adesivo já impresso.

- `tables.crud.test.ts` — CRUD, 409 de rótulo repetido (inclusive só na caixa),
  404 de mesa alheia, soft delete, rotação matando o hash anterior, cascata do
  D3, e um teste que fala **direto com o repositório** para prender o mapa fixo
  de colunas (S8).
- `tables.public.test.ts` — resolução sem sessão, 404 para hash de outra loja,
  rotacionado, removido, inventado e de loja não verificada.
- `orders.tables.test.ts` — grava e congela o rótulo; **sem mesa continua 201**;
  mesa recusada em retirada e entrega; hash alheio é 400; renomear e remover não
  mexem no histórico; `?tableId=` filtra; o `check` do banco exercitado por SQL.

⚠️ **O teste do mapa fixo de colunas precisa chamar o repositório direto.** Pela
via HTTP a proteção é inalcançável: o `removeAdditional: true` de
`routes/validators.ts` apaga o campo desconhecido antes de ele chegar ao
serviço. Medido por mutação — trocar o mapa pelas chaves do corpo mantém todos
os testes de HTTP verdes. É o S29: o schema é a primeira barreira, não a última.

## Fora de escopo, de propósito

- **Conta aberta por mesa** (`table_sessions`, fechamento, taxa de serviço).
- **Geração da imagem do QR no servidor** — o front desenha; a API devolve a URL.
- **Flag `requiresTable`** — só faz sentido depois de a loja trocar os adesivos.
- **Chamar o garçom pela tela** — outro fluxo, outro canal.
- **Mesa com capacidade, área ou mapa do salão** — o produto não os tem.
