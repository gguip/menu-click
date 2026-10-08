# Upload de imagens — desenho

**Data:** 2026-10-08 · **Estado:** desenho aprovado em conversa, aguardando revisão da spec

## O problema

Logo, capa e foto de produto são três campos de **URL** (`logoUrl`, `coverUrl`,
`photoUrl`, todos `format: "uri"`). O painel mostra uma caixa de texto e o app do
cliente põe o endereço num `<img>` cru. Isso custa três coisas:

- **A loja precisa hospedar a foto em outro lugar** antes de colar o endereço.
  Quem cadastra o cardápio pelo celular não tem onde.
- **O cardápio depende de servidor de terceiro.** A imagem some quando o
  endereço morre, e ninguém fica sabendo.
- **Qualquer endereço serve.** Uma URL arbitrária no cardápio público é
  carregada pelo navegador de todo cliente que abre o QR: funciona como
  rastreador, e a foto vem no tamanho que o dono subiu (4 MB de câmera de
  celular numa grade aberta em 4G).

## As decisões que já foram tomadas

| Decisão | Escolha |
| --- | --- |
| Onde guardar | **Cloudinary**, plano gratuito, conta que já existe (cloud `bird-corp`). Sem cartão, uso em produção permitido dentro da cota, e redimensiona pela URL. R2 pede cartão (quebra a regra de custo zero do deploy), Supabase pausa o projeto parado, `bytea` no Neon queimaria as CU-h |
| Por onde o arquivo passa | **Direto do navegador para o Cloudinary**, com assinatura da API. O arquivo nunca passa pela API: o `bodyLimit` é 128 KB e o Render gratuito não aguentaria |
| Foto trocada | **Sobrescreve o mesmo endereço** (`public_id` fixo por dono). Zero arquivo órfão, e a API nunca chama o Cloudinary |
| URL colada | **Acaba.** O painel só tem upload, e a API só aceita endereço do nosso Cloudinary, na pasta daquele restaurante |
| Dependência nova | **Nenhuma.** A assinatura é `node:crypto`; o envio é `fetch` com `FormData` |
| Configuração | **Uma variável**, `CLOUDINARY_URL`, no formato que o próprio Cloudinary entrega |

## 1. Assinatura (API)

### Rota

`POST /restaurants/:restaurantId/uploads/signature`

Corpo (`additionalProperties: false`):

```json
{ "target": "product", "productId": "<uuid>" }
```

`target` é `logo`, `cover` ou `product`. `productId` é obrigatório com
`product` e recusado (400) com os outros dois; a regra mora no serviço, com
mensagem, porque o JSON Schema condicional não a expressa de forma legível.

Resposta 200:

```json
{
  "uploadUrl": "https://api.cloudinary.com/v1_1/bird-corp/image/upload",
  "apiKey": "…",
  "timestamp": 1791000000,
  "publicId": "menuclick/<restaurantId>/products/<productId>",
  "allowedFormats": "jpg,png,webp",
  "transformation": "c_limit,w_2000,h_2000",
  "signature": "<40 hex>"
}
```

O painel devolve esses campos **como vieram** no `FormData`, junto do arquivo.
A API manda os valores prontos em vez de deixar o painel montá-los: um
parâmetro que diferisse em um caractere do que foi assinado seria recusado
pelo Cloudinary com uma mensagem que não aponta para a causa.

### Proteção

A rota **não** é pública nem `ownerOnly`. Sessão, escopo (404 em restaurante
alheio, S19) e bloqueio de loja não verificada (403) vêm do hook, porque o
parâmetro se chama `restaurantId` (S18). O teto global de 100 req/min basta:
assinar é uma conta de hash, sem banco além da checagem do produto.

Com `target: "product"`, o serviço confere que o produto existe e está vivo
**naquele** restaurante (`productsService`, a mesma checagem das rotas de
produto, S23) e responde 404 senão. Sem isso, uma loja assinaria um upload para
a pasta de produto de outra — a pasta é do restaurante da sessão, mas o id do
produto viraria um nome de arquivo escolhido pelo cliente.

### O que a assinatura trava

| Parâmetro | Valor | Por quê |
| --- | --- | --- |
| `public_id` | `menuclick/<restaurantId>/logo`, `…/cover` ou `…/products/<productId>` | é o que faz a troca sobrescrever, e o que prende o arquivo à loja |
| `allowed_formats` | `jpg,png,webp` | SVG carrega script; GIF e vídeo comem cota |
| `transformation` | `c_limit,w_2000,h_2000` | transformação **de entrada**: o Cloudinary guarda no máximo 2000 px, não a foto de 12 MP |
| `timestamp` | agora, em segundos | o Cloudinary recusa assinatura com mais de 1 hora |

A assinatura é o SHA-1, em hexadecimal, dos parâmetros acima em ordem
alfabética, no formato `chave=valor` unidos por `&`, com o `API secret`
concatenado no fim. `file`, `api_key`, `cloud_name` e `resource_type` não entram
na conta. `overwrite` não é enviado: em upload assinado o padrão já é
sobrescrever.

⚠️ **O tamanho em bytes não cabe na assinatura.** O painel recusa arquivo acima
de 5 MB antes de enviar; quem bater direto no Cloudinary com uma assinatura
válida esbarra no limite da conta (10 MB por imagem no plano gratuito), e a
transformação de entrada reduz o que fica guardado. O estrago possível é
limitado: uma assinatura vale 1 hora e um endereço só.

### Onde o código mora

- `src/cloudinary.ts` — lê e valida a configuração, assina, e reconhece URL
  nossa (seção 2). É o par de `menu-url.ts`: um arquivo, sem camada de
  repositório, porque não há banco.
- `src/services/uploads.ts` — a regra: `target` × `productId`, e a checagem do
  produto.
- `src/routes/uploads.ts` — o plugin, registrado no `buildApp()`, com `tags`,
  `summary`, `description` e `operationId`. Depois, `openapi:generate`.

## 2. O que a API aceita gravar

`logoUrl`, `coverUrl` e `photoUrl` passam a aceitar só `null` ou um endereço
com **exatamente** esta forma:

```
https://res.cloudinary.com/<cloud>/image/upload/v<dígitos>/menuclick/<restaurantId>/<alvo>.<jpg|png|webp>
```

onde `<alvo>` é `logo` para `logoUrl`, `cover` para `coverUrl` e
`products/<productId>` para `photoUrl` — com o `restaurantId` e o `productId`
**da rota**, em minúsculas (o Postgres aceita UUID em maiúsculas; o nome do
arquivo, não). A conferência é no serviço (`restaurants` e `products`), com
`ValidationError` (400). O `format: "uri"` do schema continua como primeira
barreira.

A forma é fechada de propósito:

- **Sem transformação no caminho.** O que se grava é o original versionado; a
  transformação de exibição é montada pelo app (seção 4). Aceitar transformação
  gravada deixaria o cliente escolher o que o Cloudinary processa por conta da
  loja.
- **`<cloud>` e a pasta `menuclick/` conferidos.** O endereço de outra conta do
  Cloudinary tem o mesmo host.
- **`<restaurantId>` e `<productId>` da rota.** Uma loja não aponta para a foto
  de outra, nem um produto para a foto de outro.
- **Versão obrigatória** (`v<dígitos>`). É ela que faz a foto trocada aparecer:
  o endereço sem versão continuaria servindo a antiga do cache.

### Quebra de contrato

**A foto só entra por `PATCH`.** `POST …/products` deixa de aceitar `photoUrl`,
e o cadastro (`POST /auth/register`) deixa de aceitar `logoUrl`: nos dois o id
ainda não existe, então não há endereço válido para mandar. Como o validador descarta campo a mais (`removeAdditional`), mandar o
campo não dá 400 — só não é gravado.

### Dado que já existe

URL externa já gravada (o seed, lojas de hoje) **continua sendo lida e
exibida**: a validação vale para gravação nova, e nenhuma migration reescreve
nada. Consequência: um `PATCH` que reenvie a URL antiga sem mudar leva 400 —
por isso o painel só manda o campo quando a foto mudou (ele já faz isso em
Dados da loja; o formulário de produto passa a fazer).

Não há migration nesta feature: as três colunas já existem e continuam `text`.

## 3. Painel

### Componente

Um `ImageField` em `src/ui/`, usado nos três lugares: prévia, "Escolher
imagem" (ou "Trocar"), e "Remover". Aceita `image/jpeg`, `image/png` e
`image/webp`; arquivo de outro tipo ou acima de 5 MB é recusado na hora, com
mensagem, sem sair para a rede.

A regra sem React (validar o arquivo, montar o `FormData` a partir da
assinatura) mora em `src/lib/upload.ts`; a chamada da assinatura passa por
`apiRequest`, e o envio ao Cloudinary é `fetch` direto — **sem** o Bearer, que
não pode sair para outro domínio.

### Quando o arquivo sobe

**Ao salvar, não ao escolher.** Escolher o arquivo mostra a prévia local
(`URL.createObjectURL`) e suja o formulário; o envio acontece dentro do salvar.
Como a troca sobrescreve o mesmo endereço, subir ao escolher trocaria a foto do
cardápio antes de a pessoa confirmar — e "Cancelar" não teria como desfazer.

Ordem no salvar, em Dados da loja e na edição de produto:

1. assinatura → envio ao Cloudinary (um por imagem trocada);
2. `PATCH` com os campos de texto e as URLs devolvidas (`secure_url`).

Falha no passo 1 interrompe antes do `PATCH`, com a mensagem na tela e o
formulário ainda sujo. ⚠️ Custo assumido: se o envio der certo e o `PATCH`
falhar, o arquivo novo já está no Cloudinary, mas o cardápio continua mostrando
a versão antiga — o banco guarda a URL **com versão**, e é ela que decide.
Salvar de novo conserta.

### Produto novo

O id não existe antes de criar. Salvar faz: `POST` do produto (sem foto) →
assinatura → envio → `PATCH` com `photoUrl`. Se a foto falhar, o produto fica
criado sem foto e a tela vai para a **edição** dele, com o aviso "Produto
criado, mas a foto não subiu. Tente de novo." — a navegação leva
`LEAVE_WITHOUT_ASKING`, como todo salvar que navega.

### Remover

"Remover" manda `null` no `PATCH`, como hoje. O arquivo fica no Cloudinary
(seção 6).

## 4. App do cliente

`lib/image.ts`, uma função: recebe a URL e uma largura, e, **se** o endereço for
do Cloudinary (`res.cloudinary.com/…/image/upload/`), insere
`f_auto,q_auto,c_limit,w_<largura>` logo depois de `/upload/`. Qualquer outra
URL — as externas antigas — volta intacta.

As larguras são poucas e fixas, porque cada combinação nova é uma transformação
cobrada da cota:

| Onde | Largura |
| --- | --- |
| Grade de produtos (`ProductGrid`) | 400 |
| Tela do produto (`ProductScreen`) | 800 |
| Capa (`MenuHeader`) e `og:image` | 1200 |
| Logo (`MenuHeader`) | 200 |

O painel usa a mesma ideia na miniatura da lista de produtos (largura 200); a
função é pequena o bastante para existir nos dois apps sem virar pacote.

## 5. Configuração

`CLOUDINARY_URL=cloudinary://<api_key>:<api_secret>@<cloud_name>` — o formato
que o painel do Cloudinary entrega pronto. `assertCloudinaryUrl()` roda na
subida, ao lado do `assertMenuBaseUrl()`, e **derruba o boot** se a variável
faltar ou não tiver chave, segredo e nome: sem ela nenhuma loja consegue pôr
foto, e descobrir isso no primeiro upload de um cliente é tarde.

- `.env.example` traz um valor de mentira **parseável**
  (`cloudinary://chave:segredo@nuvem`), como manda o S12: a API sobe, a
  assinatura sai, e o envio falha no Cloudinary — visível na tela, não
  silencioso.
- `vitest.config.ts` ganha o mesmo valor de mentira, ao lado do
  `MENU_BASE_URL`. A suíte não fala com o Cloudinary.
- `render.yaml` ganha a chave com `sync: false`; o valor é digitado no painel
  do Render. Mudou o `render.yaml`: "Manual sync" no Blueprint.
- `CLOUDINARY_URL` entra no `logger.redact` (S13) — o segredo está dentro dela.
- O painel e o app **não** ganham variável: tudo que o painel precisa vem na
  resposta da assinatura, e o app só reconhece o host.

Dev e produção usam a mesma conta e a mesma pasta `menuclick/`. Não colidem,
porque o caminho tem o UUID do restaurante; dividem a cota.

## 6. Limites conhecidos

- **Foto removida não é apagada do Cloudinary.** Fica um arquivo parado por
  produto (e por logo, por capa) — limite conhecido e pequeno, porque trocar
  sobrescreve. Produto removido idem; e é coerente com o soft delete: restaurar
  o produto (D7) devolve a foto junto.
- **A cota é da conta inteira** (25 créditos/mês, divididos entre espaço, banda
  e transformações), e a conta `bird-corp` pode ter outros usos. Estourar
  restringe a conta até virar o mês — as fotos podem parar de aparecer. Os
  números vêm de pesquisa; confirmar no painel do Cloudinary.
- **A validação aceita endereço bem formado de arquivo que não existe.** A API
  não consulta o Cloudinary; uma URL inventada no formato certo grava e mostra
  imagem quebrada só na própria loja.
- **Algoritmo da assinatura.** SHA-1 é o padrão; conta configurada para
  SHA-256 recusaria. A conferência manual do primeiro upload real decide.

## 7. Testes

**API** (integração, `app.inject()`):

- a assinatura confere com um cálculo independente feito no teste, para os
  três alvos, e o `publicId` tem o restaurante e o produto da rota;
- `product` sem `productId`, e `logo` com `productId`: 400;
- produto de outra loja, produto removido e id malformado: 404;
- sem sessão 401; restaurante alheio 404; loja não verificada 403;
- gravação: URL nossa do alvo certo passa; de outra loja, de outro produto, de
  outra conta, sem versão, com transformação no caminho, com extensão fora da
  lista e externa: 400; `null` continua limpando;
- `POST` de produto e cadastro com `photoUrl`/`logoUrl`: criam sem a imagem;
- URL externa já gravada (inserida direto no banco) continua saindo no cardápio
  público;
- `assertCloudinaryUrl()`: ausente, sem segredo e malformada derrubam;
- os testes de hoje que gravam `https://example.com/…` passam a usar um
  auxiliar de `test/helpers.ts` que monta uma URL válida para aquele
  restaurante.

**Painel** (jsdom, `fetch` simulado, inclusive o do Cloudinary):

- `ImageField`: tipo errado e arquivo acima de 5 MB não saem para a rede;
- edição: assinatura → envio → `PATCH` com a `secure_url`; sem mudança de
  foto, o campo não vai no corpo; "Remover" manda `null`;
- produto novo: `POST` → envio → `PATCH`; falha no envio leva à edição com o
  aviso;
- falha no envio em Dados da loja não chama o `PATCH`;
- o envio ao Cloudinary não leva `Authorization`.

**App:** `lib/image.ts` transforma URL do Cloudinary nas quatro larguras e
devolve URL externa intacta.

**Fora da suíte:** um upload real, na mão, contra a conta — é o que confirma o
algoritmo da assinatura e o formato da `secure_url`.

## Fora de escopo

Recorte na tela, várias fotos por produto, apagar arquivo no Cloudinary, migrar
as URLs externas já gravadas, e foto no cadastro da loja.
