# Painel da loja, parte 3b — Mesas e QR, e Usuários — desenho

**Data:** 2026-09-22 · **Estado:** aprovado, não implementado (branch `feat/painel-mesas-usuarios`)

## O problema

Duas entidades que a API tem desde antes do painel continuam sem tela, e as duas
só se administram por SQL na mão:

- **Mesas e QR.** `tables` existe para o QR da mesa significar alguma coisa — sem
  ela, o pedido de salão chega sem dizer de onde veio, e o garçom sai procurando
  pelo salão. O painel filtra pedidos por mesa desde a parte 1, mas não cadastra
  mesa nenhuma, não mostra o QR e não imprime adesivo.
- **Usuários.** `restaurant_users` aceita mais de uma conta por restaurante, com
  papel `owner` ou `staff`, mas o painel só conhece a conta que o cadastro criou.
  Convidar a gerente ou o atendente não tem caminho.

Fontes deste desenho: o handoff (`docs/design/painel-da-loja/README.md`, telas 12 e
14, e o protótipo `Painel da Loja.dc.html`), a spec da parte 1
(`docs/superpowers/specs/2026-09-19-painel-da-loja-parte-1-design.md`) e o contrato
em `apps/api/openapi.json`.

## As decisões que já foram tomadas

| Decisão | Escolha |
| --- | --- |
| Base da branch | Sai de `feat/painel-resumo-cozinha` (3a); a PR abre **contra a `main`**, com o aviso de mergear #22 e #23 antes — nunca empilhada |
| Biblioteca de QR | **`react-qr-code`** (só SVG, sem dependência de runtime além do React, sem script de instalação), com `level="Q"` |
| Impressão dos adesivos | **Folha escondida na própria página**, visível só no `@media print`, e `window.print()` |
| Papel do usuário | **Não se edita**: a API não tem rota; o selo é fixo e a troca é remover e convidar de novo |
| Senha do convite | **Campo "Senha provisória"** no formulário: o projeto não manda e-mail de convite |
| Remover mesa | **Entra**, com confirmação — desvio do handoff |

## Arquitetura

| Rota | Posição no rail (grupo Configuração) | Título | Quem vê |
| --- | --- | --- | --- |
| `/mesas` | depois de Horário | Mesas e QR | dono e equipe |
| `/usuarios` | depois de Dados da loja | Usuários | **só o dono** |

**Usuários é só do dono.** O item não entra no rail para `staff`, e a rota mostra
uma mensagem em vez da tela — a API responde 403 nas três chamadas
(`config: { ownerOnly: true }`), e botão morto é pior que ausência, o mesmo
raciocínio da zona destrutiva da 2a.

### A dependência nova

`react-qr-code` é a primeira dependência do painel desde a parte 1. Ela gera um
`<svg>` e nada mais: sem dependência de runtime além do React, e **sem script de
instalação** — não mexe no `allowBuilds` do `pnpm-workspace.yaml`, que o projeto
trata como decisão explícita. `level="Q"` (25% de correção de erro) atende à nota
do handoff: *"Para o adesivo impresso, use correção de erro média ou alta — o QR
vai pegar gordura, risco e luz ruim no salão."*

⚠️ **A URL dentro do QR vem pronta da API** (`qrUrl`, montada do `MENU_BASE_URL`),
e o painel só a entrega à biblioteca. Hoje o default de `MENU_BASE_URL` aponta para
`localhost:5173`, que é o **painel** — o cardápio do cliente ainda não existe —,
então um adesivo impresso agora abriria o painel. É pendência de integração
conhecida; a tela mostra a URL abaixo do QR justamente para esse erro não passar
despercebido.

## Mesas e QR

### A grade

`repeat(auto-fill, minmax(215px, 1fr))`. Cada cartão: caixa de seleção de 18 px
com o rótulo (15 px/700), QR de 104×104 sobre `surface2`, a URL em 11,5 px `ink3`,
e um rodapé separado por borda. Selecionado: borda `accent-line`.

Nota fixa do topo, literal: *"Renomear a mesa não invalida o adesivo: o QR continua
funcionando. O que invalida é gerar um código novo."*

O **último cartão da grade** é o formulário tracejado: campo "Rótulo da nova mesa" e
botão "Cadastrar mesa". Rótulo repetido é **409** da API (a unicidade não diferencia
maiúscula: com "Mesa 7" criada, "mesa 7" é 409), e a mensagem aparece nesse cartão.

### As três ações do cartão

- **Renomear** — o cartão vira campo com Salvar e Cancelar, como as linhas de opção
  da 2b. ⚠️ **Não toca no hash**: o `PATCH` da API só muda o rótulo, e é isso que a
  nota do topo promete.
- **Novo código** — confirma com o texto literal: *"O adesivo que está na mesa para
  de funcionar imediatamente. Quem apontar a câmera para o QR antigo não abre o
  cardápio."*, com o aviso *"Só faça isso se você vai reimprimir e trocar o adesivo
  agora."* Chama `POST .../tables/:id/rotate-hash`.
- ⚠️ **Remover** — **desvio do handoff**, que desenhou só as duas de cima. Salão
  muda de layout, e mesa que deixou de existir precisa sair da lista: sem isso o
  filtro por mesa do kanban acumula lixo para sempre e só some por SQL na mão. A
  confirmação (texto novo) diz: *"O adesivo dela para de funcionar. Os pedidos que
  ela atendeu continuam no histórico, com o rótulo que já tinham."* — verdade pelo
  modelo, porque `orders.table_label` é cópia congelada na criação do pedido.

### A barra de ações e a impressão

Acima da grade: **"Selecionar todas"** (que vira **"Limpar seleção"** quando tudo
está marcado) e o botão de impressão, cujo rótulo é **"Imprimir N adesivo(s)"** e,
sem seleção, **"Selecione para imprimir"**, desabilitado em `surface2`/`ink3`.

A impressão é uma **folha escondida na própria página**, visível só no
`@media print`: um adesivo por mesa selecionada, com o nome da loja, o QR grande
(180 px), o rótulo em letra grande e a URL pequena embaixo; o resto da página não
sai no papel. O botão chama `window.print()`, então a prévia do navegador é
exatamente o que vai para o papel — e salvar em PDF é o próprio diálogo do
navegador.

⚠️ **A seleção é por id e descarta o que sumiu da lista**: com dois aparelhos
abertos, a mesa removida no outro não pode entrar na contagem nem na folha.

### Cache

As mesas já são buscadas pelo filtro do kanban (`useTables`,
`["tables", restaurantId]`, com `staleTime` de 5 minutos). Esta tela usa a **mesma
chave**, e criar, renomear, girar o código ou remover a invalidam — o filtro de
Pedidos enxerga a mudança na hora.

**Nenhuma rota de mesa é `ownerOnly`** (decisão da API): mexer no salão é operação
de salão, como mexer no cardápio.

## Usuários

Nota do topo, literal: *"Dono e equipe operam o painel do mesmo jeito. A diferença é
só esta tela e a remoção do restaurante."*

### A lista

Linhas de 58 px: avatar circular de 32 px com as iniciais, nome e e-mail, o selo do
papel (Dono em `accent-soft`/`accent-line`/`accent-hi`; Equipe sem fundo) e, à
direita, **"Remover"**.

⚠️ **Na própria conta aparece "você"**, não o botão. A API recusa com 409 quem
tenta remover a si mesmo; e como só o dono administra usuários, essa regra garante
de quebra que o restaurante **nunca fica sem nenhum dono**. A comparação é pelo
**id da sessão**, nunca pelo e-mail.

**Remover pede confirmação** (texto novo): *"A conta perde o acesso na hora, e a
sessão aberta dela morre na próxima ação. Os pedidos que ela atendeu continuam no
histórico."* É verdade pelo modelo: a resolução do token junta `restaurant_users`
filtrando `deleted_at is null`, então a sessão do removido morre sozinha.

⚠️ **O papel não se edita.** O selo é texto fixo, com a nota *"O papel é escolhido
no convite. Para trocar, remova a pessoa e convide de novo."* A API não tem
`PATCH .../users/:id`, e o e-mail é único, então reconvidar com outro papel também
não funciona enquanto a conta existir. Vira pendência de API.

### O convite

Rodapé com quatro campos e o botão **"Convidar"**: nome, e-mail, **senha
provisória** e o papel (Equipe, o padrão, ou Dono).

⚠️ **A senha provisória é desvio do handoff**, que desenhou três campos. O projeto
não manda e-mail de convite: a API exige `password` na criação, e quem convida
entrega a senha à pessoa. A ajuda do campo diz isso: *"Você entrega esta senha à
pessoa. Ela troca depois, no menu da conta."* O mínimo é **8 caracteres** (o
`PASSWORD_MIN_LENGTH` da API), conferido antes da chamada.

Nota final, literal: *"Sem papel informado, o usuário nasce como equipe. Ninguém
remove a própria conta."*

E-mail já usado volta **409** da API, com a mensagem dela, no próprio formulário.

## Testes

**Puros:**

- Mesas — o rótulo do botão de impressão ("Imprimir 1 adesivo" / "Imprimir N
  adesivos" / "Selecione para imprimir"); "Selecionar todas" virando "Limpar
  seleção"; a seleção descartando mesa que sumiu da lista; rótulo vazio barrado.
- Usuários — as iniciais do avatar (um nome, dois nomes, espaço sobrando); a
  validação do convite campo a campo, com a senha de 8; "é você" decidido pelo id
  da sessão, não pelo e-mail.

**Componente:**

- **Mesas** — a grade mostra o QR (um `<svg>`) e a URL de cada mesa; criar manda o
  rótulo e a mesa aparece; rótulo repetido mostra o 409 no cartão de cadastro;
  renomear manda só o rótulo e **não** chama a rota do código novo; "Novo código"
  confirma com o texto literal antes de chamar; remover confirma e chama; sem
  seleção o botão de impressão está desabilitado, com duas mesas o texto vira
  "Imprimir 2 adesivos" e o clique chama `window.print()` (substituído no teste); a
  folha de impressão tem um adesivo por mesa selecionada.
- **Usuários** — a lista mostra papel e e-mail, e a própria conta mostra "você" em
  vez de "Remover"; convidar manda nome, e-mail, senha e papel, com Equipe como
  padrão; senha curta é barrada antes da chamada; e-mail repetido mostra o 409;
  remover confirma e chama; para `staff`, a tela não aparece e o item some do rail.

## Onde a implementação diverge do handoff

| O quê | Por quê |
| --- | --- |
| Campo "Senha provisória" no convite | A API exige `password` na criação e o projeto não manda e-mail de convite; sem o campo, não há como convidar ninguém |
| "Remover" no cartão da mesa | Salão muda de layout; sem isso, mesa que saiu fica na lista para sempre e o filtro do kanban acumula lixo |
| Texto da confirmação de remover mesa e de remover usuário | O handoff não desenhou as duas confirmações; as duas consequências (adesivo morto, sessão que morre) precisam ser ditas |
| Nota "O papel é escolhido no convite…" | O handoff supõe que dá para trocar o papel; a API não tem a rota |

## Repo

**Uma dependência nova:** `react-qr-code` em `apps/panel`. O rail ganha "Mesas e QR"
e "Usuários" no grupo Configuração; o `router.tsx` ganha duas rotas. O `CLAUDE.md`
ganha três regras: o QR sai do `qrUrl` da API e a impressão é `@media print`;
renomear não invalida o adesivo, só "Novo código"; o papel do usuário não se edita.

## Fora de escopo, de propósito

- **Trocar o e-mail de um usuário** — a API não tem rota, e já é pergunta aberta
  desde a parte 1.
- **Conta por mesa, chamar garçom, taxa de serviço** — fora do handoff, e outro
  produto (a mesa só identifica).
- **Gerar PDF dos adesivos no painel** — o diálogo de impressão do navegador já
  salva em PDF.
