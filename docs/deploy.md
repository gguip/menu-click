# Deploy do MenuClick (plano gratuito)

Roteiro da primeira subida e da verificação. O desenho e o porquê de cada
escolha estão em `docs/superpowers/specs/2026-09-30-deploy-gratuito-design.md`.

| Peça | Onde | Endereço |
| --- | --- | --- |
| App do cliente (Next, ISR) | Vercel Hobby | `https://menuclick.gguip.dev` — a raiz do QR |
| Painel (Vite) | Vercel Hobby | `https://painel.menuclick.gguip.dev` |
| API (Fastify + WebSocket) | Render, gratuito, uma instância, Virginia | `https://api.menuclick.gguip.dev` |
| Postgres | Neon, gratuito, AWS us-east-1 | — |
| E-mail | Resend (conta do TirzeFlow) | `menuclick@gguip.dev` |
| Ping | cron-job.org | `GET /health`, a cada 10 min das 06:00 às 23:00 |

⚠️ **Custo zero depende de NÃO cadastrar cartão** no Render e no Neon: sem
cartão, estourar um limite suspende o serviço em vez de cobrar.

## 1. Neon (banco)

1. Criar o projeto `menuclick`, região **AWS us-east-1** (perto da API no Render).
2. Em "Connect", com **"Connection pooling" desligado** (o host sem `-pooler`), copiar a connection string. É o `DATABASE_URL`, com dois ajustes no fim dela:
   - **tirar o `&channel_binding=require`** que o Neon acrescenta;
   - trocar `sslmode=require` por **`sslmode=verify-full`**. O `pg` já trata `require` como `verify-full` e avisa disso no log a cada subida; escrever `verify-full` mantém a mesma segurança sem o aviso.

   A caixa do Neon é só leitura: copie ("Copy snippet") e ajuste num arquivo ignorado pelo git (`apps/api/.env.neon` casa com o `.env.*` do `.gitignore`). A URL tem a senha do banco: não a cole em chat nem em issue.
3. **Criar o papel da aplicação** (S14). A URL do passo anterior é a do dono do banco (`neondb_owner`), e ela fica só para as migrations; a API conecta com um papel que não tem `DELETE`, `TRUNCATE` nem DDL, e um `delete from` esquecido no código falha no banco em vez de apagar dado. Rodar **como o dono**, depois das migrations, com a senha sorteada na hora (`openssl rand -hex 32`) e nunca escrita em chat:
   ```sql
   create role menuclick_app login password '<senha>' connection limit 10;
   grant connect on database neondb to menuclick_app;
   grant usage on schema public to menuclick_app;
   grant select, insert, update on all tables in schema public to menuclick_app;
   revoke all on table pgmigrations from menuclick_app;
   -- tabela criada por migration futura já nasce com as mesmas permissões
   alter default privileges for role neondb_owner in schema public
     grant select, insert, update on tables to menuclick_app;
   alter default privileges for role neondb_owner in schema public
     grant usage, select on sequences to menuclick_app;
   ```
   A URL dele é a do dono com usuário e senha trocados, e vai em `apps/api/.env.neon` como `APP_DATABASE_URL` (o `DATABASE_URL` de lá continua sendo o dono, para seed e consultas de manutenção). Medido na primeira aplicação: com o papel, `select ... for update`, `insert` e `update` passam; `delete`, `truncate`, `create table`, `alter table` e a leitura da `pgmigrations` são recusados; e o `migrate up` falha com `permission denied for schema public`.

## 2. Resend (e-mail)

1. Na conta do TirzeFlow, criar a chave de API **"menuclick"**, com permissão só de envio.
2. O `SMTP_URL` fica `smtps://resend:<chave>@smtp.resend.com:2465`. O domínio `gguip.dev` já está verificado — nenhum registro de DNS novo para o e-mail.

⚠️ **Porta 2465, não 465.** O plano gratuito do Render bloqueia a saída para as portas 25, 465 e 587 (desde set/2025); o Resend também atende SMTPS na 2465. Pela 465 a conexão só expira, e o erro vai só para o log — o "Esqueci a senha" responderia 202 e o e-mail nunca chegaria.

## 3. Render (API)

1. **Workspace só do MenuClick** (menu do workspace → "New Workspace", plano **Hobby, $0**; a tela vem com o Pro de $25 marcado). As 750 h gratuitas são por workspace, e serviço gratuito antigo acordado no mesmo workspace as divide.
2. No GitHub, "Settings → Applications → Render → Configure": dar acesso ao repositório `gguip/menu-click`. Sem isso o Render clona (o repositório é público), mas não recebe o aviso do CI verde e o deploy automático não dispara.
3. "New → Blueprint" apontando para o repositório: o `render.yaml` da raiz cria o serviço `menuclick-api`.
4. Preencher os três segredos (`sync: false`) quando o Render pedir: `DATABASE_URL` com a URL do **papel da aplicação** (`APP_DATABASE_URL` do `.env.neon`), `MIGRATION_DATABASE_URL` com a do **dono**, e `SMTP_URL`. Trocados, a API sobe com poder de apagar o banco e nada avisa. Para não passar o segredo por chat nem histórico do terminal, ponha cada um na área de transferência a partir do arquivo local e cole direto no campo.
5. Nos logs do primeiro deploy, conferir que as migrations rodaram antes do servidor subir.
6. Em "Settings → Custom Domains", adicionar `api.menuclick.gguip.dev` e anotar o alvo `.onrender.com` que o Render mostrar.

⚠️ **O Blueprint grava o comando de build e o de subida no serviço quando o cria.** Mudou o `render.yaml`? "Manual Deploy" publica o código novo com o comando **antigo**. Quem relê o arquivo é o **"Manual sync"** do Blueprint ("Blueprints" → `menuclick`). Foi assim que o primeiro build falhou duas vezes com o mesmo erro, o segundo já com a correção na `main`.

O build usa `corepack pnpm install`, e não `corepack enable`: o `enable` troca o atalho `/usr/bin/pnpm`, e no Render `/usr` é só leitura (`EROFS: read-only file system, unlink '/usr/bin/pnpm'`).

O deploy automático só publica **depois do CI verde** (`autoDeployTrigger: checksPass`).

## 4. Vercel — app do cliente

1. Novo projeto a partir do repositório, **Root Directory `apps/menu`**, framework Next.js.
2. Variáveis, **antes do primeiro Deploy** e com Type **Config** (a Vercel recusa Secret com prefixo `NEXT_PUBLIC_`, e Secret não vira Config depois — tem que apagar e recriar):
   - `NEXT_PUBLIC_API_URL=https://api.menuclick.gguip.dev` — **sem barra no fim**. Com ela, o app pedia `//menu/<slug>`, a API respondia 401 e todo cardápio saía 500 (os apps agora tiram a barra sozinhos, mas o valor certo continua sendo sem ela);
   - `ENABLE_EXPERIMENTAL_COREPACK=1` — a Vercel usa o pnpm do `packageManager`, e não um escolhido pela versão do lockfile.

   O valor entra no build: trocou a variável, **Redeploy sem o cache**.
3. Domínio `menuclick.gguip.dev`; anotar o alvo de CNAME que a Vercel mostrar.

## 5. Vercel — painel

1. Novo projeto a partir do repositório, **Root Directory `apps/panel`**, framework Vite, output `dist`.
2. Variáveis, Type **Config**, antes do primeiro Deploy: `VITE_API_URL=https://api.menuclick.gguip.dev` (sem barra no fim) e `ENABLE_EXPERIMENTAL_COREPACK=1`.
3. Domínio `painel.menuclick.gguip.dev`; anotar o alvo de CNAME.

O `apps/panel/vercel.json` devolve toda rota que não é arquivo para o `index.html` — sem ele, `/pedidos` recarregado daria 404.

Pelo endereço `*.vercel.app` o login falha com erro de rede, e é o esperado: o CORS da API só libera `painel.menuclick.gguip.dev`.

## 6. DNS do `gguip.dev`

Três registros **explícitos** — o curinga `*.gguip.dev` não pode decidir para onde vão:

| Tipo | Nome | Alvo |
| --- | --- | --- |
| CNAME | `menuclick` | o alvo que a Vercel mostrou para o app |
| CNAME | `painel.menuclick` | o alvo que a Vercel mostrou para o painel |
| CNAME | `api.menuclick` | o `.onrender.com` do serviço |

Nada nos registros do TirzeFlow (`api.gguip.dev`) nem nos do Resend. Depois de "Valid Configuration", a Vercel ainda leva alguns minutos para emitir o certificado; até lá o HTTPS falha no aperto de mão TLS.

## 7. Dados de demonstração

1. Da máquina local, as migrations e o seed contra o Neon (pode ser antes de a API existir — a senha do seed nunca chega a valer em produção):
   ```bash
   cd apps/api
   node --env-file=.env.neon src/db/migrate.ts up
   node --env-file=.env.neon src/db/seed.ts
   ```
2. No editor SQL do Neon, trocar o e-mail dos donos para endereços seus com "+" (o e-mail é único no banco; o "+" chega na mesma caixa) **e, na mesma instrução, invalidar a senha do seed** — `senha-de-exemplo-123` está no repositório público, e a loja não pode ficar com ela nem até o passo seguinte:
   ```sql
   update restaurant_users
      set email = '<seu-email>+tokyo@<domínio>',
          password_hash = md5(random()::text || clock_timestamp()::text)
    where email = 'dono@tokyoramen.com.br' and deleted_at is null;
   update restaurant_users
      set email = '<seu-email>+cantina@<domínio>',
          password_hash = md5(random()::text || clock_timestamp()::text)
    where email = 'dona@cantinadanona.com.br' and deleted_at is null;
   ```
   (Um valor aleatório que não é um hash bcrypt: o `bcrypt` devolve "não confere" para qualquer senha — conferido —, até o "Esqueci a senha" gravar a nova.)
3. Em `https://painel.menuclick.gguip.dev`, usar "Esqueci a senha" para cada um e definir as senhas novas — isso também prova o envio pelo Resend em produção.

O cardápio e os QR das mesas ficam públicos; o painel, só com você.

## 8. cron-job.org (ping)

- Job `GET https://api.menuclick.gguip.dev/health`.
- Agenda `*/10 6-22 * * *`, fuso **`America/Sao_Paulo`** (a cada 10 min, das 06:00 às 22:50).
- Aviso por e-mail em falha **depois de 3 seguidas**: às 06:00 a API está dormindo e leva ~50 s para acordar, acima dos 30 s de timeout, então o primeiro ping do dia falha todo dia. Com 1, seria um alarme falso por manhã.

## 9. Verificação

- [ ] `curl -s https://api.menuclick.gguip.dev/health` responde 200.
- [ ] `https://menuclick.gguip.dev/tokyo-ramen-house` abre; o QR de uma mesa no painel aponta para `https://menuclick.gguip.dev/...`.
- [ ] Um pedido de entrega com acompanhamento em tempo real.
- [ ] Limite de login com o header forjado — seis logins errados, cada um com um `CF-Connecting-IP` diferente, dão **429** na sexta:
  ```bash
  for i in 1 2 3 4 5 6; do
    curl -s -o /dev/null -w "%{http_code}\n" -X POST https://api.menuclick.gguip.dev/auth/login \
      -H "content-type: application/json" -H "CF-Connecting-IP: 1.2.3.$i" \
      -d '{"email":"ninguem@exemplo.com","password":"senha-errada-123"}'
  done
  ```
  e, logo depois, o login de **outro aparelho** (no 4G) funciona. As duas coisas juntas provam que o Cloudflare sobrescreve o header e que a chave é por cliente. **Se qualquer uma falhar, pare**: a chave do limite precisa ser revista antes de divulgar o link.

  Medido na primeira subida: o Cloudflare **recusa** a requisição que já chega com `CF-Connecting-IP` (`403`, `error code: 1000`) — o laço acima responde 403 seis vezes, e isso é melhor que o esperado: ninguém escolhe o próprio IP. O teto se prova sem o header: seis logins errados da mesma máquina dão `401 401 401 401 401 429`.
- [ ] O e-mail de recuperação de senha chega (passo 7.3) — sem isso, nenhum cadastro novo consegue verificar a loja.
- [ ] Login com `senha-de-exemplo-123` nas duas lojas de demonstração **falha**.
- [ ] `https://api.menuclick.gguip.dev/docs` **não** abre o Swagger (responde 401: em produção a rota não existe, e o que não existe cai na autenticação).
- [ ] "Novo código" nas mesas da demonstração: os códigos do seed estão no repositório público.
- [ ] No dia seguinte, o histórico do cron-job.org mostra chamadas só entre 06:00 e 23:00.

## Cuidados

- 🚨 **O `/health` não toca no banco** (há teste). Se tocasse, o ping deixaria o Neon acordado o dia todo — ~186 CU-h/mês, acima das 100 gratuitas.
- **Nenhum outro serviço gratuito no mesmo workspace do Render**: as 750 h são por workspace, e a API acordada das 6h às 23h já usa ~530.
- **A API dorme das 23h às 6h.** A primeira chamada da madrugada leva ~1 min; o cardápio continua abrindo na hora, pelo cache do ISR.
- **`CLIENT_IP_HEADER=cf-connecting-ip` só vale atrás do Cloudflare.** Em outra hospedagem, deixe vazio.
- ⚠️ **O papel restrito protege contra bug, não contra invasor.** A URL do dono continua no Render, porque as migrations rodam na subida (o gancho de pré-deploy é pago): quem executar código no processo da API lê as duas variáveis. Fechar isso é tirar as migrations do Render (um job do CI com o segredo do dono) — mudança maior, não feita.
- **Vercel Hobby é para uso não comercial.** Se o MenuClick virar produto, o plano muda.
