# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Duas audiências, com situações opostas:

- **A loja: dono e atendentes de um restaurante pequeno ou médio**, no painel
  (`apps/panel`). A tela fica aberta durante o serviço, num tablet no balcão ou
  num notebook no caixa (alvo ~1440 px, mouse e teclado), enquanto a pessoa
  também atende, embala e cobra. Está de pé, com as mãos ocupadas e a tela
  longe. Dois papéis: `owner` e `staff` fazem tudo igual, exceto administrar
  usuários e remover a loja (só `owner`).
- **O cliente: uma pessoa com fome, no celular**, que chega por um QR code na
  mesa ou por um link, nunca viu o app e não vai criar conta. Uma mão, tela
  vertical, às vezes com gente olhando. O app do cliente ainda não existe.

## Product Purpose

Cardápio digital, QR code e delivery para restaurantes, no estilo do Goomer. A
loja monta o cardápio, configura como vende (salão, retirada, entrega) e opera
os pedidos que chegam; o cliente pede sem cadastro.

**É um projeto de estudo e portfólio, sem objetivo comercial.** Nenhum
restaurante real usa o sistema. Sucesso é aprender (monorepo, Fastify,
TypeScript nativo no Node, SQL na mão) e ter um projeto que se sustente como
produto de verdade quando mostrado em entrevista ou no GitHub: o nível de
cuidado é o de algo que iria ao ar, mesmo sem ir.

## Positioning

**Em aberto, por decisão.** Hoje o objetivo é reproduzir bem o que o Goomer
faz; o MenuClick não reivindica um diferencial próprio. Não invente um em
texto de interface, README ou material de apresentação.

## Operating Context

- **Painel:** o pico (almoço de sábado) é quando precisa funcionar. Pedido novo
  se anuncia sozinho (som, título da aba, contador); ninguém aperta F5. As ações
  que mudam estado custam comida quando erradas (aceitar baixa estoque e não tem
  volta), então precisam ser difíceis de tocar por acidente. Há um modo cozinha
  em tela cheia, sem dinheiro nem dados do cliente.
- **Cliente:** chega por `/<slug>` (entrega ou retirada) ou `/<slug>?mesa=<hash>`
  (salão, vindo do adesivo da mesa). Sem onboarding: a primeira tela já é
  comida. Nome e telefone só no fim.
- **Material físico:** o adesivo de QR da mesa é impresso pelo painel e vai
  pegar gordura, risco e luz ruim.

## Capabilities and Constraints

- **Existe:** a API (Fastify + Postgres) e o painel da loja (Vite + React +
  Mantine), completo segundo o handoff em `docs/design/painel-da-loja/`.
- **Não existe ainda:** o app do cliente. Stack não decidida (Next.js com SSR é
  o candidato registrado); especificação de produto em
  `docs/frontend/app-do-cliente.md`.
- **Três modalidades de pedido** (`dine_in`, `takeaway`, `delivery`), cada uma
  com sua trilha de status; o vocabulário da tela vem da modalidade
  ("saiu para entrega", "pronto para retirada").
- **Dinheiro nunca é calculado na tela** quando a regra mora no servidor: frete,
  preço com opções (somar / mais caro / média), pedido mínimo e troco vêm da
  API. Uma conta que não fecha é lida como erro por quem confere.
- **O cliente nunca vê estoque**, só "disponível ou não".
- **O que a API não oferece** e não deve ser desenhado como se existisse: upload
  de imagem (logo e foto são URLs), impressão de comanda, relatório histórico,
  conta aberta por mesa, chamar garçom, pagamento online, conta do cliente,
  histórico de pedidos do cliente, observação no item, complemento de endereço.
- **Dependências mínimas:** nada entra sem pedido explícito do dono do projeto.

## Brand Commitments

- Nome: **MenuClick**.
- Idioma da interface: **pt-BR**. Identificadores de código em inglês.
- A copy do painel no handoff é **literal**; desvios ficam registrados na spec
  da parte 1 (`docs/superpowers/specs/2026-09-19-painel-da-loja-parte-1-design.md`).
- Voz: direta e operacional, e não esconde consequência. Onde a ação tem efeito
  que não se vê, o texto diz ("cancelar não devolve estoque depois de pronto",
  "as outras sessões foram encerradas").

## Evidence on Hand

- Dados de exemplo em `apps/api/src/db/seed.sql` (três lojas fictícias).
- **Não há** clientes, restaurantes reais, depoimentos, métricas de uso nem
  preços. Não fabrique nenhum deles.

## Product Principles

1. **Não mentir para quem confere.** Frete numa linha própria, estoque que volta
   ou não volta dito com todas as letras, "a combinar" diferente de "grátis".
2. **O painel é para o pico.** O que se usa a cada três minutos (pedidos, pausa)
   vem antes do que se usa uma vez por semana (cardápio, configuração).
3. **Cada toque a mais é um pedido a menos.** No app do cliente, sem conta, sem
   onboarding, dados pessoais só no fim.
4. **Estado que a loja não configurou não é estado bom.** Dia sem horário é dia
   fechado; bairro sem cadastro não é frete grátis. A tela avisa em vez de
   presumir.
5. **Só construir o que foi pedido.** O produto cresce por partes pequenas.

## Accessibility & Inclusion

- **WCAG 2.2 AA** como mínimo nas duas superfícies.
- Painel: contraste alto, alvos grandes e texto legível a um metro da tela.
- Cliente: uso com uma mão, no celular, em tela vertical.
