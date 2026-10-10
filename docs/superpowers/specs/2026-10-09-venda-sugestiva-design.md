# Venda sugestiva — desenho

Data: 2026-10-09

## O problema

O carrinho do app do cliente só mostra o que a pessoa já escolheu. A loja não
tem como lembrar da bebida, da sobremesa ou do adicional na hora em que a
pessoa está fechando o pedido — que é quando um item a mais custa um toque.

## O que foi decidido

Quatro decisões, tomadas com o dono do projeto:

1. **A loja escolhe à mão** o que é sugerido. Nada de sugestão por produto
   ("quem pede pizza vê borda") nem automática (pelo que sai junto).
2. **A sugestão aparece no carrinho**, e só nele.
3. **O toque adiciona direto quando dá, e abre a tela do produto quando há
   grupo de opções obrigatório.** A loja pode sugerir qualquer produto.
4. **A marcação é um interruptor na edição do produto**, sem tela nova.

Suposições, não perguntadas e assumidas aqui:

- Vale nas três modalidades (salão pelo QR, entrega e retirada pelo link).
- O app mostra **no máximo 6** sugestões.
- Não há medição de quanto a sugestão vendeu.

## Fora do escopo

- Sugestão por produto ou por seção.
- Ordem própria das sugestões (segue a do cardápio).
- Sugestão automática a partir do histórico de pedidos.
- Métrica de conversão.
- Sugestão fora do carrinho (depois de adicionar um item, no finalizar).

O desenho não fecha a porta para nenhum deles: a coluna continua valendo se
um dia houver ordem própria ou uma tela de sugestões.

## Banco

Migration nova, criada por `migrate:create`:

```sql
-- Up Migration
alter table products add column is_suggested boolean not null default false;

-- Down Migration
alter table products drop column is_suggested;
```

O default é o backfill: todo produto existente nasce **não** sugerido, e o
deploy não muda o carrinho de nenhuma loja até o dono ligar o primeiro
interruptor.

Sem índice: a coluna nunca é filtro de consulta. O cardápio público já traz
todos os produtos, e quem separa os sugeridos é o app.

## API

### Gestão

`isSuggested: boolean` entra em três lugares de `routes/products.ts`:

- no corpo do `POST /restaurants/:restaurantId/products` (opcional, default
  `false`);
- no corpo do `PATCH …/products/:id` (opcional);
- nas respostas de produto (criação, leitura, listagem e edição).

No repositório, a coluna entra no tipo de linha, no mapper, no `insert` e no
mapa fixo campo→coluna do `update` (D8, S8). Não há regra de negócio nova no
serviço: sugerir um produto esgotado ou sem foto é permitido — quem filtra o
que aparece é o app, com o cardápio de agora.

### Cardápio público

`suggested: boolean` em cada produto de `GET /menu/:slug/products`.

O campo entra no `menuProductResponseSchema` **por decisão** (S10): o app
precisa dele para montar a faixa, e ele não revela nada da operação da loja —
quem abre o carrinho vê as sugestões de qualquer jeito. O nome público é
`suggested`, sem o `is`, para acompanhar `available`, que já está lá.

`MenuProduct` é um `Omit` de `Product`, então o campo novo de `Product` chega
ao tipo sozinho; o que o segura fora da resposta é o schema. O mapper do
cardápio traduz `isSuggested` para `suggested` e tira o primeiro do tipo
público, para não haver dois nomes para a mesma coisa.

Sem rota nova. O `openapi.json` é regerado.

## Painel

Na edição e na criação do produto (`ProductFormPage`), um interruptor no card
"Dados do produto":

- rótulo: **Sugerir no carrinho**
- ajuda: **Aparece em "Que tal adicionar?" quando o cliente abre o carrinho.**

Ele faz parte do formulário: suja a `SaveBar` e sai no mesmo `POST`/`PATCH`
dos outros campos. Não é interruptor que salva sozinho — está dentro de um
formulário que já tem barra de salvar, e dois jeitos de salvar na mesma tela
confundem.

A listagem de produtos não muda.

## App do cliente

### A regra (`lib/suggestions.ts`)

Função pura, sem React:

```ts
suggestionsFor(products: MenuProduct[], lines: CartLine[], limit = 6): MenuProduct[]
```

Do cardápio de agora, na ordem em que ele vem:

1. fica quem tem `suggested`;
2. sai quem não está `available`;
3. sai quem já tem alguma linha no carrinho (pelo `productId`, com qualquer
   combinação de opções);
4. corta em `limit`.

A sugestão vem sempre do **cardápio de agora**, nunca do carrinho guardado —
a mesma decisão da miniatura. Produto que deixou de ser sugerido ou esgotou
some da faixa na próxima vez que o cardápio for lido.

### A faixa (`CartScreen`)

Entre a lista de itens e o total, quando há ao menos uma sugestão:

- título: **Que tal adicionar?**
- uma fileira que rola para o lado, um cartão por sugestão;
- cada cartão: miniatura (largura 400, a mesma da grade e da linha do
  carrinho — nenhuma transformação nova na cota do Cloudinary), nome, preço e
  um botão;
- produto sem foto mostra o fundo neutro no lugar, como a linha do carrinho.

O preço é o **mesmo da grade** (`fromPrice`): o valor do produto, ou "a
partir de" com as opções mais baratas quando há grupo obrigatório.

Sem sugestão sobrando, a faixa não é renderizada — nem o título.

`CartScreen` recebe as sugestões prontas e dois callbacks; quem chama
`suggestionsFor` e decide o que o toque faz é o `MenuApp`, que já tem o
cardápio, o carrinho e a navegação.

### O toque

- **Produto sem grupo obrigatório** (nenhum grupo dele com `minOptions > 0`):
  o botão é **Adicionar**. Entra uma linha com quantidade 1, sem opções e sem
  observação, pelo mesmo `addLine` de sempre. O produto some da faixa, porque
  agora está no carrinho.
- **Produto com grupo obrigatório**: o botão é **Escolher**. Abre a
  `ProductScreen` como entrada do histórico. Ao adicionar, a tela já chama
  `history.back()`, e o voltar cai no carrinho — de onde a pessoa veio. O
  voltar sem adicionar faz o mesmo.

O rótulo diferente avisa antes do toque que o segundo caso não é de um toque
só.

Grupo opcional não bloqueia o toque direto: quem quiser o adicional abre o
produto pelo cardápio.

### Quando a loja não pode receber pedido

O carrinho só é alcançável por quem pode pedir, então a faixa não precisa de
estado próprio para loja fechada ou pausada.

## Testes

**API** (`test/products.suggested.test.ts`, integração com o Postgres):

- produto novo nasce com `isSuggested: false`;
- `POST` com `isSuggested: true` grava e devolve;
- `PATCH` liga e desliga;
- o cardápio público devolve `suggested` em cada produto, e **não** devolve
  `isSuggested`;
- valor que não é booleano no corpo é 400.

**Painel** (`product-form`):

- o interruptor reflete o valor do produto carregado;
- ligar suja a barra e o `PATCH` leva `isSuggested: true`;
- produto novo manda `isSuggested` no `POST`.

**App** (`suggestions.test.ts`, `cart-screen.test.tsx`, e um teste de fluxo no
`MenuApp`):

- a regra: só `suggested`, sem indisponível, sem o que está no carrinho, teto
  de 6, ordem do cardápio;
- a faixa não aparece sem sugestão;
- **Adicionar** põe a linha no carrinho e tira o cartão da faixa;
- **Escolher** abre a tela do produto, e adicionar por lá volta ao carrinho
  com o item.

## Documentação

`CLAUDE.md`: um item na seção do painel (o interruptor) e um na do app do
cliente (a regra da faixa e os dois comportamentos do toque); a seção de
cardápio público ganha `suggested` na lista de campos que saem por decisão.
