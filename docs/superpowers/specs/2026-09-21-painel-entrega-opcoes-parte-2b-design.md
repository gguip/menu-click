# Painel da loja, parte 2b — Entrega e Grupos de opções — desenho

**Data:** 2026-09-21 · **Estado:** aprovado, não implementado (branch `feat/painel-entrega-opcoes`)

## O problema

A parte 2a deu ao painel o que a loja configura sem regra de cálculo: modalidades,
horário, dados. Ficaram de fora as duas telas que concentram regra — e as duas
lacunas custam dinheiro:

- **Entrega não se configura pelo painel.** A loja criada pelo cadastro nasce com
  taxa fixa de R$ 0; ligar a Entrega em Modalidades (o que a 2a permite) passa a
  entregar de graça, e o aviso âmbar da 2a só consegue dizer isso — não tem para
  onde mandar a pessoa. O modo por bairro sem bairro nenhum recusa todo pedido de
  entrega, e o aviso do kanban também não tem para onde mandar.
- **Grupos de opções só se escolhem, não se criam.** O formulário de produto da
  parte 1 liga o produto a grupos já cadastrados, mas o painel não cadastra grupo
  nenhum. Sem isso a loja não vende pizza (tamanho, sabor) nem hambúrguer com
  adicional pelo painel.

Fontes deste desenho: o handoff (`docs/design/painel-da-loja/README.md`, telas 9 e
10, e o protótipo `Painel da Loja.dc.html`), a spec da 2a
(`docs/superpowers/specs/2026-09-20-painel-configuracao-parte-2a-design.md`) e o
contrato em `apps/api/openapi.json`.

## As decisões que já foram tomadas

| Decisão | Escolha |
| --- | --- |
| Base da branch | **Empilhada na 2a** (`feat/painel-configuracao`); a PR abre contra a `main` depois do merge da #20 |
| "usado em N produtos" | **Contado no painel**, pelos `optionGroupIds` dos produtos; campo na API vira pendência |
| Como Entrega salva | **Uma barra para tudo**, inclusive o interruptor "a combinar"; bairros antes do restaurante |
| Como Grupos edita | **Na linha**: cada linha (e o cabeçalho do grupo) vira campos e salva sozinha |
| Disponibilidade da opção | **Entra**: interruptor "Disponível" por opção, salva sozinho com volta atrás |
| Entrega por distância | **Desabilitada**, como no handoff |

## Arquitetura

### Duas telas, nos lugares do handoff

| Rota | Grupo no rail | Título |
| --- | --- | --- |
| `/grupos-de-opcoes` | Operação, depois de Seções | Grupos de opções |
| `/entrega` | Configuração, entre Modalidades e Horário | Entrega |

Rotas dentro do `PanelLayout`, cada uma com `handle: { title }`, como as da 2a.

### Ligações com o que já existe

- O `DeliveryAlert` do kanban (`features/orders/OrdersNotices.tsx`) ganha o botão
  **"Configurar entrega"** para `/entrega` — o handoff o previa e o comentário da
  parte 1 o adiou até esta tela existir. Como Modalidades e Entrega reusam o
  mesmo componente, o botão aparece nas três telas.
- Em Modalidades, a ajuda do interruptor de Entrega ("Frete e área atendida ficam
  na tela de Entrega") passa a ter link para `/entrega`, e o aviso "Entrega ligada
  com frete grátis" também.
- O formulário de produto mostra link para `/grupos-de-opcoes` quando a loja não
  tem nenhum grupo cadastrado — hoje o bloco fica vazio sem dizer onde se cria.

### O que muda em `src/api/`

- `optionGroups.ts`: criar, editar e remover grupo; criar, editar e remover opção.
- `delivery.ts`: `putNeighborhoods(restaurantId, neighborhoods)`.

### Duas regras que valem para as duas telas

- **Carregando/erro só quando não há dado** (`data === undefined`) — a lição da
  review final da 2a: um refetch que falha mantém o `data` antigo, e trocar o
  formulário pela mensagem apagaria o que a pessoa digitava.
- **Uma instância de mutação por controle independente**, com a escrita no cache
  no `onSuccess` **do hook**, nunca em callback por chamada (ver `CLAUDE.md`).

## Entrega

### O que ela lê

O restaurante vem do cache que a casca mantém (`useRestaurant`). Os bairros vêm de
`["delivery-neighborhoods", restaurantId]` — **a mesma chave** do
`useDeliveryAlert`, então salvar os bairros atualiza sozinho o aviso do kanban e o
de Modalidades.

### No topo

O `DeliveryAlert` quando o modo **salvo** é por bairro e a lista **salva** está
vazia (e o "a combinar" salvo está desligado — a regra da 2a). Reflete o que o
servidor faz agora, não o que está sendo digitado.

### Como o frete é calculado

Três cartões de escolha única, com o texto do protótipo:

| Cartão | Ajuda |
| --- | --- |
| Por bairro | Uma lista de bairros, cada um com o seu preço |
| Taxa fixa | Um valor só para toda a área atendida |
| Por distância | Ainda não disponível nesta versão *(desabilitado)* |

Trocar o cartão só troca a seção mostrada. **Voltar para taxa fixa não apaga os
bairros**: eles continuam guardados e voltam se a loja retornar ao modo por bairro.

**Por bairro** — "Bairros atendidos", com a contagem ("1 bairro" / "N bairros");
tabela de bairro, frete e "Remover"; no rodapé, campo de bairro + campo de frete +
"Adicionar bairro". Vazia: **"Nenhum bairro cadastrado"** em `warn` e *"Neste
estado a loja não consegue calcular frete nenhum e recusa os pedidos de entrega.
Isto não é entrega grátis."*

⚠️ **Bairro repetido é barrado ao adicionar**, porque a API também o recusa (409).
A comparação é a da API — sem acento, sem caixa, sem espaço sobrando —, então
"Centro" e "centro " são o mesmo bairro. Frete zero é permitido: é entrega grátis
naquele bairro.

**Taxa fixa** — "Taxa fixa para toda a área atendida", um campo em reais com o
mesmo parser do preço do produto.

### Regras de valor

- **Entrega grátis acima de** — *"Compara com o valor dos itens, sem o frete. Uma
  sacola de R$ 115 + R$ 9 de frete não ganha a isenção."* ⚠️ **Vazio desliga a
  promoção e vai como `null`, nunca 0**: zero seria "grátis acima de R$ 0", sempre
  grátis. É o `nullable: true` que o `PATCH` da API tem justamente para isso (F12).
- **Pedido mínimo** — *"Vale só para entrega. Zero significa sem mínimo — retirada
  e salão nunca são afetados."*
- **Aceitar pedido com frete a combinar** — interruptor com a ajuda que muda com o
  estado:
  - ligado: *"Quando o frete não pode ser calculado, o pedido entra com "frete a
    combinar" e o valor é acertado por telefone. O total do pedido chega sem o
    frete."*
  - desligado: *"Quando o frete não pode ser calculado, o pedido de entrega é
    recusado na hora. Nenhum pedido entra com valor em aberto."*

### Salvar

Uma `SaveBar` para a tela inteira. O que está na tela é comparado com o cache, e só
o que mudou sai:

1. os bairros, num `PUT` da lista inteira — só se a lista mudou (comparação sem
   depender de ordem, pela mesma normalização);
2. depois, os campos do restaurante, num `PATCH` com só o que mudou.

⚠️ **Bairros antes do restaurante.** Trocar para "por bairro" antes de a lista
existir faria a loja recusar entrega por um instante.

Se o `PATCH` falhar, os bairros já ficaram salvos, a mensagem aparece e a barra
continua suja **só no que faltou** — de graça, porque a sujeira é a comparação com
o cache. As duas escritas são instâncias de mutação separadas, cada uma gravando o
próprio cache no hook.

## Grupos de opções

### No topo

O cartão **"Regra de preço — a escolha que muda o valor final"**, com as três regras
lado a lado, texto literal do protótipo:

| Regra | Ajuda | Exemplo | Quando |
| --- | --- | --- | --- |
| Somar | Soma o preço de tudo que foi escolhido. | Bacon R$ 6,00 + Ovo R$ 3,00 = R$ 9,00 | Adicionais, borda, bebida extra |
| Mais caro | Cobra só a opção mais cara entre as escolhidas. | Margherita R$ 62 + Calabresa R$ 72 = R$ 72,00 | Pizza meio a meio pelo sabor mais caro |
| Média | Cobra a média das opções escolhidas. | Margherita R$ 62 + Calabresa R$ 72 = R$ 67,00 | A outra convenção de meio a meio |

E o botão **"Novo grupo"**: um cartão em edição no topo da lista (nome, mínimo,
máximo, regra), com Criar/Cancelar.

### Um cartão por grupo

**Cabeçalho** — nome, pill de intervalo, **pill da regra** (`accent-soft`) e "usado
em N produtos" à direita.

- O intervalo segue o protótipo: **"escolhe {mínimo} a {máximo}"**; quando os dois
  são iguais, **"escolhe {n}"**.
- "Editar" vira os campos do cabeçalho, com Salvar/Cancelar.
- **"Remover grupo"** confirma num diálogo que diz o número: *"O grupo sai dos N
  produtos que o usam. Pedidos já feitos não mudam."* A API tira o grupo dos
  produtos na mesma transação, em silêncio — sem o número, a pessoa não sabe o que
  está desmontando.

**Tabela de opções** — Opção / Preço / Qtd. máx. / Disponível / Editar.

- "Editar" vira a linha em campos, com Salvar, Cancelar e Remover. Remover opção
  **não** confirma: é uma linha, e o pedido já feito congela nome e preço.
- **Disponível** é interruptor que salva sozinho, com volta atrás — o mesmo
  comportamento de Modalidades. É a operação do pico ("acabou a calabresa").
- **"+ Adicionar opção"** (tracejado) abre uma linha nova em edição. Preço vazio é
  R$ 0,00: cobre a escolha obrigatória sem custo ("ponto da carne").

⚠️ **Aviso âmbar quando o grupo não se completa**: se o mínimo passa do número de
opções **disponíveis**, *"O cliente não consegue completar este grupo: ele exige N
escolhas e só M opções estão disponíveis."* É a loja que marcou todos os sabores
como esgotados. A API aceita esse estado, então a tela informa e não trava.

### "usado em N produtos"

Contado no painel: todos os produtos, em páginas de 100 (`fetchAllPages`), somando
os `optionGroupIds`. Custa uma requisição a cada 100 produtos, dentro do teto de
100/min. **Provisório** — a troca por um campo calculado no SQL fica como pendência
de API.

### Validação

Só o que a API recusa, antes da chamada: nome de 1 a 60 caracteres; máximo ≥ 1;
mínimo ≤ máximo; preço ≥ 0; quantidade máxima ≥ 1. Nome de grupo repetido volta 409
da API, e a mensagem aparece no próprio cartão.

### Estado e cache

- Cada linha, cada cabeçalho e cada interruptor é um componente com a **própria**
  mutação.
- As mutações invalidam `["option-groups", restaurantId]` no `onSuccess` do hook.
  **O seletor de grupos do formulário de produto passa a usar essa mesma chave** —
  sem isso, um grupo criado aqui não apareceria lá até o cache vencer.
- Remover grupo invalida também os produtos: os `optionGroupIds` deles mudam.
- Linha aberta se perde ao sair da tela, como nos outros formulários.

## Testes

**Puros** (módulos sem React, como `openingHours.ts`):

- `features/settings/delivery.ts` — a normalização do nome de bairro (acento,
  caixa, espaço) e o bloqueio de repetido; a diferença tela × cache: bairros sem
  depender de ordem, e o `PATCH` só com o que mudou; "grátis acima de" vazio indo
  como `null`.
- `features/optionGroups/optionGroups.ts` — o texto do intervalo; a contagem de uso
  a partir dos `optionGroupIds`; a condição do aviso de grupo que não se completa.

**Componente:**

- **Entrega** — trocar para "por bairro", adicionar dois bairros e salvar manda o
  `PUT` **antes** do `PATCH`; `PATCH` que falha deixa os bairros salvos e a barra
  suja; bairro repetido barrado sem chamada; "Por distância" desabilitado; o aviso
  do topo segue o salvo e não o digitado; a ajuda do "a combinar" troca com o
  interruptor.
- **Grupos** — criar grupo; editar uma linha manda o `PATCH` só dela; "Disponível"
  volta atrás na falha; mínimo > máximo barrado sem chamada; 409 de nome aparece no
  cartão; o diálogo de remoção mostra a contagem; o aviso aparece quando o mínimo
  passa das opções disponíveis.
- **Ligações** — o "Configurar entrega" leva a `/entrega`; o formulário de produto
  mostra o link para Grupos quando a loja não tem grupo nenhum.

## Onde a implementação diverge do handoff

| O quê | Por quê |
| --- | --- |
| Coluna **Disponível** na tabela de opções | A API tem `available`; sem ele, tirar um sabor esgotado exige apagar a opção e recriar depois |
| Aviso de grupo que não se completa | Copy nova: o handoff não previu o estado, que a API aceita e deixa o produto sem como ser pedido |
| Texto do diálogo de remover grupo | Copy nova: o handoff não desenhou a confirmação, e a remoção desmonta produtos em silêncio |
| Intervalo "escolhe {n}" quando mínimo = máximo | O protótipo só mostra "escolhe X a Y"; "escolhe 2 a 2" leria como erro |

## Repo

Nenhuma dependência nova. O rail ganha "Grupos de opções" em Operação e "Entrega"
em Configuração; o `router.tsx` ganha duas rotas. O `CLAUDE.md` ganha três regras:
Entrega salva bairros antes do restaurante; "grátis acima de" vazio vai como
`null`, nunca 0; a contagem de uso de grupo é do painel e é provisória.

## Fora de escopo, de propósito

- **Entrega por distância** — precisa de faixas de km e geocodificação, que a API
  ainda não tem.
- **Reordenar opções** — o handoff não desenhou setas para opções.
- **Upload de imagem.**
- **Aviso de alterações não salvas ao sair** — decisão única, para os quatro
  formulários.
- **Mesas e QR, Usuários, Resumo do dia, Modo cozinha** — parte 3.
