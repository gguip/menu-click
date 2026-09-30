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
2. Copiar a connection string **direta** (não a "pooled"), com `sslmode=require` no fim. É o `DATABASE_URL`.

## 2. Resend (e-mail)

1. Na conta do TirzeFlow, criar a chave de API **"menuclick"**, com permissão só de envio.
2. O `SMTP_URL` fica `smtps://resend:<chave>@smtp.resend.com:2465`. O domínio `gguip.dev` já está verificado — nenhum registro de DNS novo para o e-mail.

⚠️ **Porta 2465, não 465.** O plano gratuito do Render bloqueia a saída para as portas 25, 465 e 587 (desde set/2025); o Resend também atende SMTPS na 2465. Pela 465 a conexão só expira, e o erro vai só para o log — o "Esqueci a senha" responderia 202 e o e-mail nunca chegaria.

## 3. Render (API)

1. "New → Blueprint" apontando para o repositório: o `render.yaml` da raiz cria o serviço `menuclick-api`.
2. Preencher `DATABASE_URL` e `SMTP_URL` quando o Render pedir (são os dois segredos, `sync: false`).
3. Nos logs do primeiro deploy, conferir que as migrations rodaram antes do servidor subir.
4. Em "Settings → Custom Domains", adicionar `api.menuclick.gguip.dev` e anotar o alvo `.onrender.com` que o Render mostrar.

O deploy automático só publica **depois do CI verde** (`autoDeployTrigger: checksPass`).

## 4. Vercel — app do cliente

1. Novo projeto a partir do repositório, **Root Directory `apps/menu`**, framework Next.js.
2. Variável `NEXT_PUBLIC_API_URL=https://api.menuclick.gguip.dev`.
3. Domínio `menuclick.gguip.dev`; anotar o alvo de CNAME que a Vercel mostrar.

## 5. Vercel — painel

1. Novo projeto a partir do repositório, **Root Directory `apps/panel`**, framework Vite, output `dist`.
2. Variável `VITE_API_URL=https://api.menuclick.gguip.dev`.
3. Domínio `painel.menuclick.gguip.dev`; anotar o alvo de CNAME.

O `apps/panel/vercel.json` devolve toda rota que não é arquivo para o `index.html` — sem ele, `/pedidos` recarregado daria 404.

## 6. DNS do `gguip.dev`

Três registros **explícitos** — o curinga `*.gguip.dev` não pode decidir para onde vão:

| Tipo | Nome | Alvo |
| --- | --- | --- |
| CNAME | `menuclick` | o alvo que a Vercel mostrou para o app |
| CNAME | `painel.menuclick` | o alvo que a Vercel mostrou para o painel |
| CNAME | `api.menuclick` | o `.onrender.com` do serviço |

Nada nos registros do TirzeFlow (`api.gguip.dev`) nem nos do Resend.

## 7. Dados de demonstração

1. Da máquina local, rodar o seed contra o Neon (a variável de ambiente tem prioridade sobre o `.env`):
   ```bash
   DATABASE_URL='<connection string do Neon>' pnpm --filter @menuclick/api db:seed
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
- Aviso por e-mail em falha.

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
- [ ] O e-mail de recuperação de senha chega (passo 7.3) — sem isso, nenhum cadastro novo consegue verificar a loja.
- [ ] Login com `senha-de-exemplo-123` nas duas lojas de demonstração **falha**.
- [ ] `https://api.menuclick.gguip.dev/docs` responde 404.
- [ ] No dia seguinte, o histórico do cron-job.org mostra chamadas só entre 06:00 e 23:00.

## Cuidados

- 🚨 **O `/health` não toca no banco** (há teste). Se tocasse, o ping deixaria o Neon acordado o dia todo — ~186 CU-h/mês, acima das 100 gratuitas.
- **Nenhum outro serviço gratuito no mesmo workspace do Render**: as 750 h são por workspace, e a API acordada das 6h às 23h já usa ~530.
- **A API dorme das 23h às 6h.** A primeira chamada da madrugada leva ~1 min; o cardápio continua abrindo na hora, pelo cache do ISR.
- **`CLIENT_IP_HEADER=cf-connecting-ip` só vale atrás do Cloudflare.** Em outra hospedagem, deixe vazio.
- **Vercel Hobby é para uso não comercial.** Se o MenuClick virar produto, o plano muda.
