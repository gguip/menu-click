# Deploy do MenuClick em plano gratuito — desenho

**Data:** 2026-09-30 · **Estado:** implementado (subida pendente do roteiro em `docs/deploy.md`) (branch `feat/deploy`)

## O problema

O MenuClick está completo nas três modalidades (PRs #27 e #28), mas só roda no
`localhost`. Para servir de portfólio, precisa de um link público onde dá para
abrir o cardápio de uma loja, escanear o QR de uma mesa, pedir e acompanhar — e
o painel da loja por trás. O projeto é de **estudo**: o custo tem que ser
**quase zero**.

O dono do projeto já paga um AWS Lightsail (cerca de R$ 50/mês) para o
**TirzeFlow**, que tem usuários reais todo dia e responde em `api.gguip.dev`.
Ele tem o domínio `gguip.dev` e uma conta no Resend com esse domínio verificado.

## As decisões que já foram tomadas

| Decisão | Escolha |
| --- | --- |
| Onde roda | **Plataformas gratuitas, isoladas do TirzeFlow**: nada do MenuClick no Lightsail — um projeto de estudo não divide CPU, memória nem disco com produção |
| Domínio | Subdomínios de `gguip.dev`, com registros **explícitos** (o curinga `*.gguip.dev` não pode decidir para onde vão) |
| API acordada | Ping no `GET /health` pelo **cron-job.org**, a cada 10 min das 06:00 às 23:00 (horário de Brasília); de madrugada a API dorme |
| E-mail | **Resend do TirzeFlow**, com chave de API própria ("menuclick") e remetente próprio |
| Painel ↔ API | O painel chama a API **direto** (CORS), sem reescrita da Vercel — ver "IP do cliente" |
| IP do cliente | `CLIENT_IP_HEADER=cf-connecting-ip` (revisado no plano; ver "IP do cliente") |
| Regiões | Render em **Virginia** e Neon em **AWS us-east-1**: API e banco perto um do outro; só o navegador cruza até os EUA |
| Dados de demonstração | Seed uma vez em produção, com os e-mails dos donos trocados para endereços do dono do projeto e senhas novas definidas pelo "Esqueci a senha" |

## Onde fica cada peça

| Peça | Onde | Endereço |
| --- | --- | --- |
| App do cliente (Next, ISR) | Vercel Hobby, projeto `menuclick` | `https://menuclick.gguip.dev` — a raiz do QR (`MENU_BASE_URL`) |
| Painel (Vite, estático) | Vercel Hobby, projeto `menuclick-painel` | `https://painel.menuclick.gguip.dev` |
| API (Fastify + WebSocket) | Render, web service gratuito, **uma instância** | `https://api.menuclick.gguip.dev` |
| Postgres | Neon, plano gratuito (0,5 GB) | `DATABASE_URL` com `sslmode=require` |
| E-mail | Resend (conta do TirzeFlow, domínio `gguip.dev` já verificado) | `MenuClick <menuclick@gguip.dev>` |
| Ping | cron-job.org (gratuito) | `GET https://api.menuclick.gguip.dev/health` |

Fatos dos planos gratuitos, conferidos em 2026-09-30:

- **Render:** o serviço dorme depois de **15 min sem tráfego** e leva **cerca de 1 min** para acordar; **750 h/mês** de instância (o mês inteiro acordado são ~744 h); WebSocket suportado (mensagem conta como tráfego); o Postgres gratuito **vence em 30 dias** — por isso o banco não fica lá; o agendador de tarefas (cron) é pago.
- **Neon:** gratuito para sempre, sem cartão; 0,5 GB por projeto; **100 CU-horas/mês**; suspende depois de 5 min parado (não dá para desligar no gratuito) e acorda sob demanda.
- **Vercel Hobby:** gratuito, **só uso pessoal e não comercial** — serve para portfólio; ISR suportado.

## O sono da API e as cotas

- Das 06:00 às 23:00 o ping a cada 10 min mantém a API acordada: ~17 h/dia, **~530 h/mês** das 750 do Render.
- Entre 23:00 e 06:00 a primeira chamada de API espera ~1 min. O **cardápio** continua abrindo na hora (sai do cache do ISR); quem espera é o painel, a criação do pedido e o acompanhamento, e só a primeira chamada.
- 🚨 **O `/health` não pode tocar no banco.** É isso que deixa o Neon dormir entre os pedidos de verdade: 24 h por dia de banco acordado seriam ~186 CU-h/mês, acima das 100 gratuitas. Hoje ele não toca (`routes/health.ts`), e um teste passa a prender isso.
- ⚠️ **Nenhum outro serviço gratuito no mesmo workspace do Render**: as 750 h são por workspace, e um segundo serviço acordado esgotaria a cota dos dois.
- O cron-job.org avisa por e-mail quando o ping falha — é o aviso de queda no horário acordado.

## IP do cliente (e o limite de requisições)

⚠️ **Revisado ao escrever o plano** — a versão aprovada propunha `TRUST_PROXY=1`
(confiar em um salto de proxy), e isso não funciona no Render. Lá o
`X-Forwarded-For` chega como `cliente, borda-do-Cloudflare, interno-do-Render`,
e o endereço interno **muda a cada requisição**: com `TRUST_PROXY=1`, o limite
de login contaria cada tentativa num endereço diferente e **nunca** daria 429
([relato do mesmo defeito num projeto no Render](https://github.com/Vihanga-JM/LeaveFlow/pull/27)).
E `TRUST_PROXY=true` usa o primeiro endereço da lista, que o cliente escreve.

- O Render fica atrás do Cloudflare, e o Cloudflare **sobrescreve** o header
  `CF-Connecting-IP` na borda com o IP de quem conectou: um valor só, que o
  cliente não consegue forjar. A API passa a aceitar
  **`CLIENT_IP_HEADER=cf-connecting-ip`**: quando configurado, a chave do limite
  de requisições é esse header (e, se ele faltar, o `request.ip` de sempre).
- `TRUST_PROXY` fica `false` em produção — o `request.ip` só sobra como reserva.
- Nome de header inválido em `CLIENT_IP_HEADER` derruba o boot, como `MENU_BASE_URL`.
- ⚠️ Só é seguro onde **toda** requisição passa por um proxy que sobrescreve o
  header. No Render é assim (o domínio próprio e o `.onrender.com` passam pelo
  Cloudflare); em outra hospedagem, a variável tem que ficar vazia.
- **O painel chama a API direto**, como o app do cliente: por uma reescrita da
  Vercel, o `CF-Connecting-IP` que chegaria à API seria o da Vercel, e todos os
  lojistas dividiriam um teto só. O token vai no header `Authorization`, sem
  cookie, então CORS basta.
- `CORS_ORIGINS=https://menuclick.gguip.dev,https://painel.menuclick.gguip.dev`.

## O que muda no código

- `apps/api/src/limits.ts` + `src/client-ip.ts`: `CLIENT_IP_HEADER` (nome de header, validado no boot) e a chave do limite de requisições lida dele; `TRUST_PROXY` não muda.
- `apps/api/src/db/seed.sql`: as lojas nascem com `email_verified_at = now()`.
- `apps/panel/vercel.json`: toda rota que não é arquivo volta para o `index.html` (a SPA). O painel já lê `VITE_API_URL`; em produção ela é `https://api.menuclick.gguip.dev`.
- `apps/menu`: nenhuma mudança de código — `NEXT_PUBLIC_API_URL=https://api.menuclick.gguip.dev` no projeto da Vercel.
- `render.yaml` na raiz: o serviço da API (Node 24, pnpm por corepack, build filtrado para `@menuclick/api`), o comando de subida (`migrate:up` e depois o servidor), `healthCheckPath: /health`, e a lista de variáveis — os segredos com `sync: false`, preenchidos no painel do Render, **nunca** no repositório.
- A conexão com o Neon por `DATABASE_URL` com `sslmode=require`: o plano confere se o `pg` instalado aceita sem mudança no `db/pool.ts`.

## Deploy

- **Migrations na subida**, antes do servidor escutar. O gancho de pré-deploy do Render é pago; com uma instância só, não há duas subidas disputando a migration.
- **Render publica só depois do CI verde** (opção "After CI Checks Pass" do auto-deploy). A Vercel publica a cada push na `main`.
- Variáveis da API em produção:

| Variável | Valor |
| --- | --- |
| `NODE_ENV` | `production` (desliga o `/docs`, recusa o e-mail de console) |
| `TRUST_PROXY` | `false` |
| `CLIENT_IP_HEADER` | `cf-connecting-ip` |
| `DATABASE_URL` | a do Neon, com `sslmode=require` — segredo |
| `DB_POOL_MAX` | `5` |
| `CORS_ORIGINS` | `https://menuclick.gguip.dev,https://painel.menuclick.gguip.dev` |
| `MENU_BASE_URL` | `https://menuclick.gguip.dev` |
| `EMAIL_DRIVER` | `smtp` |
| `SMTP_URL` | `smtps://resend:<chave "menuclick">@smtp.resend.com:2465` — segredo (a 465 e a 587 são bloqueadas no Render gratuito) |
| `EMAIL_FROM` | `MenuClick <menuclick@gguip.dev>` |
| `PASSWORD_RESET_URL` | `https://painel.menuclick.gguip.dev/recuperar-senha` |
| `EMAIL_VERIFICATION_URL` | `https://painel.menuclick.gguip.dev/verificar-email` |

## Dados de demonstração

O banco de produção nasce vazio, e o seed de hoje criaria as lojas **bloqueadas**
(sem `email_verified_at`) e com donos de e-mails que não são do dono do projeto.

Roteiro, uma vez, depois do primeiro deploy:

1. Rodar o seed no Neon.
2. Trocar por SQL o e-mail dos dois donos para endereços do dono do projeto com "+" (`<e-mail>+tokyo@…`, `<e-mail>+cantina@…`) — o e-mail é único no banco, e o "+" chega na mesma caixa.
3. Definir as senhas novas pelo "Esqueci a senha" do painel de produção — o que prova, de ponta a ponta, o envio pelo Resend.

O cardápio e os QR das mesas ficam públicos para qualquer um pedir; o painel,
só com o dono.

## O que fica com o dono do projeto

Exige as contas dele, e o plano traz o roteiro passo a passo:

- criar os dois projetos na Vercel (monorepo: diretório raiz `apps/menu` e `apps/panel`) e o serviço no Render pelo `render.yaml`;
- criar o projeto no Neon e copiar a `DATABASE_URL`;
- criar a chave "menuclick" no Resend;
- criar os registros de DNS dos três subdomínios (CNAME para a Vercel e para o Render) e os domínios nos projetos;
- agendar o ping no cron-job.org.

## Verificação depois do primeiro deploy

- `curl https://api.menuclick.gguip.dev/health` responde 200.
- `https://menuclick.gguip.dev/tokyo-ramen-house` abre; o QR de uma mesa no painel aponta para o domínio do app.
- Um pedido de entrega com acompanhamento em tempo real (WebSocket pelo Render).
- O login responde 429 na sexta tentativa por minuto, **mesmo mandando um `CF-Connecting-IP` forjado a cada tentativa** — prova de que o Cloudflare sobrescreve o header; e um segundo aparelho (4G) continua conseguindo entrar — prova de que a chave é por cliente.
- `https://api.menuclick.gguip.dev/docs` responde 404.
- O cron-job.org registra as chamadas, e nenhuma de madrugada.

## Testes automáticos

- `CLIENT_IP_HEADER`: com ele configurado, seis logins com o mesmo header vindos de endereços diferentes dão 429 na sexta; headers diferentes contam separado; sem o header na requisição, vale o `request.ip`.
- Nome inválido de `CLIENT_IP_HEADER` derruba o boot.
- O seed marca as lojas como verificadas.
- O `vercel.json` do painel volta as rotas para o `index.html`.
- O `/health` responde 200 com o banco inacessível (prende que ele não toca no banco).

## Fora de escopo, de propósito

- **Múltiplas instâncias da API** — o limite de requisições e o emissor do acompanhamento são do processo (ver "Limites de exposição" e "Acompanhamento" no `CLAUDE.md`).
- **Backup do banco** — o Neon gratuito guarda um histórico curto de restauração; um backup próprio fica para quando houver dado que importe.
- **Observabilidade** além do aviso de falha do cron-job.org e dos logs das plataformas.
- **Domínio próprio do MenuClick** — os subdomínios de `gguip.dev` bastam para o portfólio; trocar depois exige reimprimir os QR.
