# Taxa de entrega — desenho

**Data:** 2026-09-12 · **Estado:** proposta, aguardando revisão

## O problema

`delivery` existe desde a migration `add-order-type-and-status`, e até hoje **é
de graça**. O restaurante não tem onde dizer quanto cobra para entregar, nem até
onde entrega, e o pedido não tem onde guardar isso. Na prática significa que
todo delivery do MenuClick sai com frete zero e a loja acerta por fora — ou
desiste de usar o sistema para entrega.

É a última peça do que a plataforma precisa para operar delivery de verdade.

## As decisões que já foram tomadas

| Decisão | Escolha |
| --- | --- |
| Modos de cobrança | **três**: por bairro, por distância, taxa fixa |
| Modo distância | **faixas de km** (até 3km = R$5, 3–6km = R$8…), não valor por km |
| Além da última faixa | **não entrega** — o limite cai fora da regra, sem raio máximo separado |
| Entrega grátis | valor zerado **é** entrega grátis; e há "grátis acima de X" |
| Frete no pedido | entra no `total_in_cents`, **e** fica guardado à parte |
| Bairro | casado pelo campo `neighborhood` do endereço, normalizado |
| Geocodificação | **Nominatim**, e só no modo distância |
| "Entrega a combinar" | setting da loja; o acerto acontece **fora** do sistema |
| Saber se entrega | **endpoint separado**, público, antes de montar o pedido |

## Arquitetura

### O modo mora no restaurante, e é um só por vez

`restaurants.delivery_fee_mode` é `'neighborhood' | 'distance' | 'fixed'`, uma
união `as const` (o runtime proíbe `enum`). Um restaurante cobra de **uma**
forma; permitir várias simultâneas exigiria uma regra de precedência que
ninguém pediu e que o dono não saberia explicar ao cliente.

Acompanham três colunas:

- `delivery_fixed_fee_in_cents` — usada só no modo `fixed`. **Zero é entrega
  grátis**, não ausência de configuração.
- `free_delivery_above_in_cents` — nulo significa "não existe essa promoção".
- `delivery_fee_to_arrange` — o booleano do "a combinar" (ver adiante).

⚠️ **"Grátis acima de X" compara com o SUBTOTAL dos itens, nunca com o total.**
Comparar com o total seria circular: o total inclui o frete, que é o que se
está decidindo. Escrito aqui porque é exatamente o tipo de detalhe que vira bug
silencioso e só aparece num pedido de valor de fronteira.

### Duas tabelas, uma por modo que precisa de linhas

**`delivery_neighborhoods`** — `(restaurant_id, name, normalized_name,
fee_in_cents)`. O `normalized_name` é o nome sem acento e em minúsculas, gerado
pelo mesmo `String.normalize("NFD")` que o slug já usa, e é ele que tem o índice
único parcial por restaurante. Sem isso, "Jardim América" e "jardim america"
conviveriam como dois bairros, que é o mesmo problema que fez `categories`
indexar por `lower(name)`.

**`delivery_distance_bands`** — `(restaurant_id, up_to_meters, fee_in_cents)`.
As faixas são cumulativas e ordenadas: a faixa que vale é a primeira cujo
`up_to_meters` é maior ou igual à distância. Guardar **metros** e não
quilômetros evita fração — é a mesma razão de todo dinheiro do projeto estar em
centavos.

Não existe tabela para `fixed`: uma tabela de uma linha é uma coluna.

⚠️ **Configuração ausente não é frete zero.** Restaurante em modo bairro sem
nenhum bairro cadastrado, ou em modo distância sem nenhuma faixa, cai no mesmo
caminho de "não consegue determinar" — responde `toArrange` ou recusa, conforme
o setting. É o mesmo princípio de "dia sem faixa é dia fechado" do horário:
ausência de configuração significa ausência de serviço, nunca serviço de graça.
Tratar o vazio como zero faria a loja entregar de graça para a cidade inteira
por esquecimento, que é o erro mais caro que este desenho pode cometer.

`free_delivery_above_in_cents` vale nos **três** modos: ela é promoção do
restaurante, não propriedade de um jeito de calcular. Quando ela se aplica, o
frete gravado é `0` — entrega grátis, pelo caminho normal.

### O frete congela junto com o resto do pedido

`orders.delivery_fee_in_cents`, nulável, e o `total_in_cents` passa a ser
**subtotal dos itens + frete**.

Três estados, e eles são distintos de propósito:

| `delivery_fee_in_cents` | Significa |
| --- | --- |
| um valor > 0 | o frete cobrado |
| `0` | entrega grátis |
| `null` | **a combinar**, ou pedido que não é `delivery` |

Um `check` amarra: só pedido `delivery` pode ter frete não nulo. É a mesma rede
que o endereço de entrega já tem.

⚠️ **Isto muda o significado de `total_in_cents` e é breaking.** Hoje toda
leitura de pedido satisfaz `Σ(unitPrice × quantity) = total`. Depois desta
mudança, pedidos de entrega satisfazem `Σ(unitPrice × quantity) + frete =
total`. Toda superfície que mostra o pedido precisa mostrar o frete, senão a
conta não fecha na tela de quem confere — que foi exatamente o defeito que a PR
dos grupos de opções embarcou e só um teste ponta a ponta pegou.

O troco passa a ser conferido contra o total **com** frete. Conferir contra o
subtotal deixaria o entregador na porta com troco insuficiente, que é o
problema que o campo existe para evitar.

### O endpoint de cotação informa; a criação decide

```
POST /menu/:slug/delivery-quote
```

Público, como o cardápio. Recebe o endereço no corpo (não na querystring: URL
vai para log de proxy e histórico, e endereço de cliente não deve morar lá — é
o mesmo raciocínio do S21). Responde:

```json
{ "deliversTo": true, "feeInCents": 800, "isFree": false, "toArrange": false,
  "servedNeighborhoods": ["Centro", "Jardim América"] }
```

`servedNeighborhoods` sai só no modo bairro, e existe para a tela poder oferecer
um seletor em vez de texto livre — a normalização protege contra variação de
escrita, mas um seletor evita a variação.

⚠️ **A criação do pedido recalcula a cotação no servidor e recusa com 409 se a
loja não entrega naquele endereço.** O endpoint de cotação não é autoridade: é
conveniência para a tela. Entre cotar e pedir cabe o tempo de montar o carrinho,
e cabe um cliente batendo direto na API. É a mesma separação de
`isOpen` (informa) e do bloqueio de 409 (decide), pelo mesmo motivo.

O frete gravado no pedido é o que a **criação** calculou, nunca um valor vindo
do corpo — pela mesma razão que `totalInCents` não existe no corpo.

### "A combinar" é a saída honesta, não um modo

`restaurants.delivery_fee_to_arrange` é um booleano. Quando a cotação **não
consegue** determinar o frete — bairro fora da lista, distância além da última
faixa, ou o Nominatim indisponível — o comportamento depende dele:

- **ligado**: responde `toArrange: true`, e o pedido é aceito com
  `delivery_fee_in_cents = null`. O cliente e a loja combinam por fora.
- **desligado**: responde `deliversTo: false`, e a criação recusa com 409.

O acerto acontecendo fora do sistema é decisão consciente: modelar negociação de
frete dentro da API exigiria um canal de conversa, contraproposta e aceite —
três coisas que o produto não tem e que não se justificam para resolver o caso
de borda.

### Nominatim: só no modo distância, e sob a política dele

**Esta é a primeira dependência externa em runtime do projeto.** Não há nenhuma
chamada HTTP de saída no código hoje, e isso muda o perfil de risco: o serviço
pode estar fora, lento, ou banir o projeto.

A [política de uso](https://operations.osmfoundation.org/policies/nominatim/) é
vinculante, e violá-la **dá banimento**:

| Regra | Como o desenho cumpre |
| --- | --- |
| Máximo **1 req/s** | uma porta de serialização em processo, com fila |
| Resultado **precisa** ser cacheado | tabela `geocode_cache`, consultada antes de qualquer chamada |
| **Autocomplete proibido** | não existe rota de busca de endereço; a cotação é um POST por endereço completo |
| User-Agent válido obrigatório | header fixo identificando a aplicação, em `limits.ts` |

`geocode_cache` é `(normalized_query, latitude, longitude, found, fetched_at)`.
Guarda inclusive o **negativo** (`found = false`): sem isso, um endereço que o
Nominatim não conhece seria consultado de novo a cada tentativa, que é a forma
mais fácil de estourar o limite.

⚠️ **A porta de 1 req/s é por processo**, igual ao contador de rate limit e ao
emissor de WebSocket. Com duas instâncias, o limite efetivo dobra e passa a
violar a política. Está documentado como limitação conhecida, com a mesma saída
das outras duas (Redis), e é a razão de a cotação ser cache-first.

O restaurante também precisa de coordenada, e ela sai do mesmo caminho: o
endereço dele é geocodificado e guardado em `restaurants.latitude/longitude`.

**A distância é haversine, calculada em Node**, em `domain/delivery.ts`. Aqui
não vale o argumento que manteve a conta de horário no Postgres: aquela depende
do banco de fusos, que é dado externo que muda; haversine é aritmética pura,
sem dado de apoio, então a segunda implementação não teria com o que discordar.

### Teto próprio para a cotação

A rota é anônima e pode disparar chamada externa — exatamente o perfil que o
S25 descreve para o `/auth/login`. Ganha um teto por IP mais apertado que os 100
req/min gerais, com o número e o porquê em `limits.ts`.

## 🚨 Todas as superfícies que isto toca

A PR anterior embarcou um defeito porque uma superfície de leitura não estava
listada em tarefa nenhuma. Esta tabela existe para isso não repetir.

| Superfície | O que muda |
| --- | --- |
| `POST /menu/:slug/delivery-quote` | **nova**, pública |
| `GET /menu/:slug` | ganha o modo e o "grátis acima de X", para a tela avisar antes |
| `POST /restaurants/:restaurantId/orders` | calcula o frete, soma no total, recusa 409 se não entrega |
| `GET /restaurants/:restaurantId/orders/:orderId` | mostra `deliveryFeeInCents` |
| `GET /restaurants/:restaurantId/orders` (listagem) | idem — mesmo schema do detalhe |
| `GET /orders/:orderId?token=` (**recibo do cliente**) | idem — a conta precisa fechar aqui |
| `GET`/`PATCH /restaurants/:restaurantId` | o modo e as colunas de configuração |
| `PUT /restaurants/:restaurantId/delivery-neighborhoods` | **nova** |
| `PUT /restaurants/:restaurantId/delivery-distance-bands` | **nova** |
| WebSocket `/orders/:orderId/track` | **nada** — transmite mudança de estado, não conteúdo |
| `openapi.json` | regerado |
| `seed.sql` | os restaurantes de exemplo ganham configuração de frete |

## Implementação em duas partes

O desenho é um só, mas a execução se separa num ponto natural — e a separação
importa porque o risco não está distribuído por igual.

**Parte 1 — os modos sem dependência externa.** Bairro, taxa fixa, grátis acima
de X, "a combinar", o endpoint de cotação, o frete no pedido e as cinco
superfícies de leitura. Zero chamada externa. Entrega valor sozinha: dois dos
três modos cobrem a maioria dos restaurantes urbanos.

**Parte 2 — distância e Nominatim.** As faixas de km, a geocodificação com
cache, a porta de 1 req/s, a coordenada do restaurante e o teto próprio da rota.
É a parte que pode ser banida por um serviço de terceiro, e isolá-la deixa a
Parte 1 fora desse risco.

## Fora de escopo, de propósito

- **Pedido mínimo** por valor — é outro conceito (recusa o pedido, não cobra por ele).
- **Frete por peso ou volume** — o catálogo não tem essas dimensões.
- **Vários modos simultâneos** no mesmo restaurante.
- **Negociação de frete dentro do sistema** — é a decisão do "a combinar".
- **Rastreio do entregador em mapa** — outro produto.
