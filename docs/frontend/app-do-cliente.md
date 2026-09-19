# App do cliente — cardápio, QR code e delivery

Documento para quem vai desenhar as telas. Descreve **o produto e os estados**,
não a implementação. Tudo checado contra a API que existe hoje
(`apps/api/openapi.json`).

---

## 🚨 Antes de tudo: isto é UM app, não dois

"App de delivery" e "app do QR code" parecem dois produtos, e não são. Os dois
consomem **as mesmas rotas** e compartilham cardápio, carrinho, grupos de
opções, cálculo de preço, forma de pagamento e troco.

A diferença é pequena, mora no fim do fluxo, e é o campo `type` do pedido:

| | cardápio | carrinho | endereço | frete | mesa | acompanha |
| --- | --- | --- | --- | --- | --- | --- |
| **Entrega** | igual | igual | ✅ obrigatório | ✅ | — | ✅ |
| **Retirada** | igual | igual | — | — | — | ✅ |
| **Salão (QR)** | igual | igual | — | — | ✅ | ❌ |

**São três modos do mesmo app.** Desenhá-los como dois produtos duplicaria umas
três telas de cada quatro.

---

## Quem usa, e em que situação

**Uma pessoa com fome, no celular, que nunca viu este app antes e não vai criar
conta.** Não há login, não há senha, não há "meus pedidos". Ela chega por um QR
code na mesa ou por um link que alguém mandou.

Isso decide o desenho:

- **Não existe onboarding.** A primeira tela já é comida.
- **Celular, uma mão, vertical.** Provavelmente com a outra mão ocupada.
- **Na mesa, com pressa e com gente olhando.** O fluxo do QR precisa ser o mais
  curto dos três.
- **Cada toque a mais é um pedido a menos.** O cliente pede nome e telefone só
  no fim, nunca no começo.

---

## Como o app descobre em que modo está

Tudo começa na URL. Só existem duas formas:

```
/<slug-da-loja>                    →  entrega ou retirada
/<slug-da-loja>?mesa=<hash>        →  salão (veio do QR code da mesa)
```

Com `?mesa=`, o app resolve o código e recebe de volta **o rótulo da mesa**
("Mesa 7"). Isso precisa aparecer na tela, com destaque, desde o primeiro
instante: é como a pessoa percebe que escaneou o adesivo errado **antes** de a
comida ir para a mesa errada.

⚠️ Se o código não resolver (adesivo velho, mesa removida, código trocado), o
app **não deve travar**. A loja existe e o cardápio funciona — o que ele perde é
a mesa. O certo é seguir sem mesa e avisar discretamente, não uma tela de erro.

A loja também declara o que aceita (`isDelivery`, `isTakeaway`, `isQrcode`), e o
app só pode oferecer o que ela aceita.

---

## O mapa de telas

| Tela | Propósito |
| --- | --- |
| **Cardápio** | a home. É onde a pessoa chega |
| **Produto** | escolher as opções e a quantidade |
| **Carrinho** | conferir e ajustar |
| **Finalizar** | modalidade, dados, endereço, pagamento |
| **Pedido enviado** | o comprovante |
| **Acompanhamento** | só entrega e retirada |
| **Loja fechada** | um estado, mas merece desenho próprio |

---

## Tela por tela

### Cardápio

O topo mostra a loja: nome, logo, tipo de cozinha, e **se está aberta agora**.

⚠️ **"Fechado" tem duas causas, e os textos precisam ser diferentes:**

| Situação | O que dizer |
| --- | --- |
| Fora do horário | *"Fechado. Abre amanhã às 18h"* — com a grade, para a pessoa saber quando voltar |
| A loja pausou os pedidos | *"A loja não está aceitando pedidos no momento"* — não adianta dizer quando abre, porque não se sabe |

A API entrega as duas informações separadas justamente para isso, e a grade da
semana vem junta — sem ela, "fechado" é um beco sem saída para quem acabou de
escanear o QR.

Antes do carrinho, o topo também precisa anunciar o que muda a decisão de
compra: **"frete grátis acima de R$ 50"** e **"pedido mínimo R$ 30"**, quando a
loja tiver configurado.

O cardápio vem **agrupado por seção**, na ordem que a loja definiu (Entradas,
Pratos, Bebidas — a sequência da refeição, não alfabética). Produtos sem seção
caem num grupo "Sem categoria" no fim.

Cada produto mostra nome, descrição, preço e foto. ⚠️ **Produto indisponível
precisa aparecer assim mesmo** — visível e não clicável. Sumir com ele faz o
cliente procurar um prato que ele sabe que existe.

⚠️ **O cliente nunca vê quantidade em estoque**, só "dá para pedir ou não". A
API não expõe o número, e é de propósito.

*Nota técnica para o layout: a paginação é por seção, e os produtos de uma seção
vêm todos de uma vez. Rolagem infinita carrega seções, não produtos.*

### Produto

Onde o pedido é montado de verdade, e a tela com mais regra.

Um produto pode ter **grupos de opções** — "Escolha 2 sabores", "Adicionais" —
e cada grupo tem mínimo e máximo de escolhas.

O que a tela precisa deixar óbvio:

- **Quais grupos são obrigatórios**, e quanto falta escolher. O botão de
  adicionar ao carrinho fica travado até fechar os obrigatórios, e precisa dizer
  *por que* está travado — "Escolha 2 sabores" —, nunca só estar apagado.
- **Quantas escolhas ainda cabem** no grupo ("2 de 3").
- **O preço mudando ao vivo.** Esta é a parte mais importante da tela.

🚨 **O preço das opções NÃO é uma soma simples**, e é aqui que uma tela ingênua
mente para o cliente. Cada grupo tem uma regra:

| Regra | Como calcula | Exemplo real |
| --- | --- | --- |
| **Somar** | soma tudo, quantidade multiplica | bacon + borda |
| **Mais caro** | cobra só a opção mais cara escolhida | meio a meio: R$ 45 e R$ 50 → cobra R$ 50 |
| **Média** | média ponderada das escolhidas | meio a meio: R$ 45 e R$ 50 → cobra R$ 47,50 |

Uma pizza de R$ 30 com sabores de R$ 45 e R$ 50 custa **R$ 80** na regra "mais
caro". Somar ingenuamente daria R$ 125 — quase o dobro. **A tela não deve
calcular preço por conta própria**; o servidor é quem decide, e o cliente não
pode ver um número no produto e outro no total.

Opção indisponível simplesmente não aparece.

### Carrinho

Itens, quantidades, e **as opções escolhidas visíveis em cada linha** — sem
elas, duas pizzas meio a meio diferentes parecem a mesma coisa.

⚠️ **Dois itens iguais com opções iguais viram uma linha só**, com a quantidade
somada. Opções diferentes geram linhas separadas. A tela precisa refletir isso,
senão a pessoa adiciona duas vezes e acha que sumiu.

Se a loja tem pedido mínimo e o carrinho ainda não chegou lá, **dizer quanto
falta** — *"Faltam R$ 12 para o pedido mínimo"* —, não só bloquear.

### Finalizar

O fluxo mais longo, e onde o pedido se perde. Ele **muda conforme a modalidade**.

**Escolha da modalidade** — só as que a loja aceita. Vindo do QR da mesa, esta
etapa não existe: já é salão.

**Dados** — nome e telefone. Só isso, e só aqui. Não há cadastro.

**Endereço** — só em entrega, e obrigatório. São rua, número, bairro, cidade,
estado e CEP.

⚠️ **Não existe campo de complemento hoje** (apartamento, bloco, ponto de
referência). Está na lista para ser acrescentado no backend — vale desenhar o
espaço dele.

⚠️ **No modo "por bairro", a loja tem uma lista de bairros atendidos** e a API
devolve essa lista. Use um **seletor**, não texto livre: bairro digitado
diferente não casa com a lista e o pedido é recusado no fim, depois de a pessoa
ter montado o carrinho inteiro.

**O frete aparece antes de finalizar.** Existe uma cotação que responde: entrega
aí? quanto custa? é grátis? A tela deve consultá-la assim que tiver o endereço,
não no último botão. Quatro respostas possíveis, quatro textos:

| Resposta | O que dizer |
| --- | --- |
| Um valor | *"Entrega: R$ 9,00"* |
| Zero | *"Entrega grátis"* — e comemorar, se foi a promoção |
| A combinar | *"A loja combina a entrega com você"* |
| Não entrega | *"Esta loja não entrega no seu endereço"* — e oferecer retirada, se a loja aceitar |

**Pagamento** — dinheiro, cartão na entrega, pix ou vale-refeição, conforme a
loja aceita. Em dinheiro, perguntar **troco para quanto**.

⚠️ **"Não preciso de troco" tem que ser uma opção explícita.** Deixar em branco é
válido e significa "tenho o valor exato" — mas se a tela não disser isso, a
pessoa inventa um número. E o valor informado **não pode ser menor que o total**,
senão o pedido é recusado: melhor a tela avisar na hora do que o entregador
descobrir na porta.

**O resumo final precisa fechar a conta**, com o frete numa linha própria:

```
Itens                R$  92,00
Entrega              R$   9,00
TOTAL                R$ 101,00
```

⚠️ Sem a linha do frete, o total não bate com a soma dos itens, e quem confere
lê como erro.

### Pedido enviado

**O que a tela mostra depende da modalidade, e a diferença é grande:**

**Entrega e retirada** — o pedido pode ser acompanhado. Guarde o código de
acompanhamento (a API devolve **uma única vez**, nesta resposta) e ofereça o
link. Se a pessoa perder essa tela, não há como recuperar.

**Salão (QR)** — a tela acaba aqui, e isso é por desenho, não por falta.
Quem está na mesa **não acompanha o pedido**: pede, e a comida chega. A tela
deve encerrar com algo tranquilizador — *"Pedido enviado para a cozinha. É só
aguardar na Mesa 7"* — e **não** oferecer acompanhamento que não existe.

### Acompanhamento (entrega e retirada)

Atualiza sozinho, em tempo real, conforme a loja muda o estado.

**O vocabulário muda com a modalidade** — o mesmo estado interno tem nomes
diferentes:

| Estado | Entrega | Retirada |
| --- | --- | --- |
| aceito | Pedido aceito | Pedido aceito |
| preparando | Preparando | Preparando |
| despachado | **Saiu para entrega** | **Pronto para retirada** |
| final | Entregue | Retirado |

A tela também mostra o que foi pedido, para funcionar depois de um recarregar.

⚠️ **A conexão em tempo real cai** — celular trocando de rede, túnel, elevador.
A tela precisa reconectar sozinha e não ficar num "carregando" eterno. E precisa
funcionar em redes que bloqueiam conexão persistente, caindo para consulta
periódica.

Pedido cancelado pela loja precisa de um estado próprio e claro.

### Loja fechada

Merece tela, não um aviso pequeno: quem escaneou um QR às 23h precisa saber se
volta amanhã ou se a loja pausou. O cardápio continua visível — só não dá para
pedir.

---

## Estados que precisam de desenho

| Estado | Quando |
| --- | --- |
| **Loja não existe** | link errado, ou loja removida |
| **Loja fora do horário** | com a grade da semana |
| **Loja pausou os pedidos** | texto diferente do anterior |
| **Mesa não resolveu** | segue sem mesa, com aviso discreto |
| **Produto indisponível** | visível, não clicável |
| **Opção obrigatória faltando** | com o que falta escrito |
| **Abaixo do pedido mínimo** | com quanto falta |
| **Loja não entrega no endereço** | com a saída: retirada |
| **Frete a combinar** | o pedido é aceito assim mesmo |
| **Estoque acabou** | pode ser recusado ao aceitar, depois de enviado |
| **Cardápio vazio** | a loja ainda não cadastrou nada |
| **Conexão perdida** | no acompanhamento, e no meio do carrinho |

---

## O que a API **não** oferece

- **Login ou conta do cliente** — e não vai ter. Telefone é a identidade.
- **Histórico de pedidos** — quem perdeu o link perdeu o acompanhamento
- **Observação no item ou no pedido** — "sem cebola", "deixar na portaria"
  ainda não existem. Estão na lista para o backend; vale prever o espaço
- **Complemento no endereço** — idem
- **Pagamento online** — o sistema registra a forma, quem cobra é a loja
- **Cancelar o próprio pedido** — só a loja cancela
- **Chamar o garçom**, avaliar, favoritar, repetir pedido anterior
- **Gorjeta ou taxa de serviço**
- **Acompanhamento em pedido de salão** — decisão, não lacuna

---

## Sugestão de fatiamento

**v1 — o caminho do QR code:** cardápio, produto com opções, carrinho,
finalizar sem endereço, "pedido enviado". É o fluxo mais curto e o único que
não depende de frete.

**v2 — entrega:** endereço, cotação de frete, pedido mínimo, troco, e o
acompanhamento em tempo real.

**v3:** retirada (é a entrega sem endereço), e os refinamentos de estado.

Começar pelo QR não é só por ser menor: é o fluxo em que a pessoa está **dentro
da loja**, então um erro de desenho é percebido na hora, por alguém que pode
reclamar — o melhor lugar possível para descobrir problema.
