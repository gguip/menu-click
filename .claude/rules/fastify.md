# Regras: Fastify

Boas práticas **obrigatórias** para a API (`apps/api`), baseadas na documentação oficial do Fastify. Valem para todo código novo de rotas, plugins e configuração do server.

> **Contexto do projeto:** a API roda **TypeScript nativo no Node** (ver `CLAUDE.md`). Todos os exemplos respeitam isso — imports locais com extensão `.ts`, `import type` para tipos, e **nada de `enum`** (use uniões `as const`).

## 1. Estrutura: tudo é plugin, com encapsulamento

- **F1 — Separe "montar o app" de "escutar".** Crie a instância numa factory `buildApp()` que só registra plugins/rotas e retorna o app; o `listen()` fica no entrypoint (`server.ts`). É isso que permite testar com `app.inject()` sem abrir socket.
- **F2 — Organize features como plugins encapsulados.** Cada domínio (`restaurants`, `menu`, `orders`, ...) é um plugin async registrado com `app.register()`. O que um plugin decora/registra **não vaza** para os irmãos — use isso para isolar contexto.
- **F3 — Use `fastify-plugin` (fp) só quando algo precisa ser global.** Se um decorator/hook deve valer para toda a app (ex.: conexão de banco, auth), embrulhe com `fp()` para quebrar o encapsulamento **de propósito**. Caso contrário, mantenha encapsulado.
- **F4 — Rotas são plugins async** — `async (app: FastifyInstance) => { app.get(...) }` em `src/routes/`, registradas no `buildApp()`. Lembre da extensão `.ts` no import.
- **F5 — Plugins só carregam depois de `.listen()`/`.ready()`/`.inject()`.** Não acesse decorators no top-level antes disso; acesse dentro de hooks/handlers ou via `app.after()`.

## 2. Rotas & handlers

- **F6 — Handlers async que retornam o payload.** Retorne o objeto (`return {...}`) em vez de misturar `reply.send()` com `return`. Use `reply.code(201)` para outro status.
- **F7 — Não use arrow function em handler/hook que precisa de `this`.** O Fastify faz bind de `this` na instância; arrow quebra isso. Prefira `async function (req, reply) {}` quando for usar `this`.
- **F8 — Prefira rotas estáticas/paramétricas a RegExp** em caminhos sensíveis a performance.

## 3. Validação & serialização (sempre com JSON Schema)

- **F9 — Toda rota que recebe input declara `schema`** para `body`, `querystring`, `params` e/ou `headers`. A validação só roda para `application/json` (salvo uso de `content`).
- **F10 — Toda rota declara `schema.response` por status code.** Isso ativa o `fast-json-stringify` (mais rápido) e, principalmente, **filtra a saída** — só serializa os campos do schema, evitando vazar dados sensíveis.
- **F11 — Reaproveite schemas com `app.addSchema()` + `$id`/`$ref`.** Não duplique JSON Schema entre rotas.
- **F12 — Cuidado com coerção.** O Fastify usa `coerceTypes: 'array'` e `useDefaults: true`. Para campos que aceitam null use `nullable: true` em vez de `anyOf: [..., {type:'null'}]` (evita `0`/`false` virarem `null`). **Não ligue `allErrors` global** — só em APIs pesadas de formulário.
- **F13 — Validador custom retorna, nunca `throw`.** Retorne `{ value }` ou `{ error }` (throw quebra com hooks async).

## 4. Erros

- **F14 — Centralize com `app.setErrorHandler()`** e `app.setNotFoundHandler()`. **Sanitize** a resposta: não exponha stack nem detalhes internos do schema.
- **F15 — Erros de domínio via `@fastify/error`** (objetos de erro consistentes, com `code`) — quando formos criar erros custom.
- **F16 — Para tratar erro de validação na mão**, use `attachValidation: true` na rota e leia `req.validationError`.

## 5. Decorators

- **F17 — Estenda instância/req/reply com `decorate`/`decorateRequest`/`decorateReply`**, nunca atribuindo propriedades direto no objeto.
- **F18 — Inicialize `decorateRequest`/`decorateReply` com um valor "vazio"** (ex.: `null`) e preencha em hook — evita shape mutante (V8) e é mais rápido.

## 6. Logging

- **F19 — Use o logger nativo (pino), já ligado.** Logue via `app.log` / `req.log`, nunca `console.log`.
- **F20 — Redija segredos** (`logger.redact`) e nunca logue senha, token ou dado de cartão.

## 7. Testes

- **F21 — Teste com `app.inject()`** (sem subir socket), usando o `buildApp()` da regra F1.
- **F22 — `await app.ready()` antes de asserts** que dependem de plugins; **`await app.close()`** ao final de cada teste.
- **F23 — Teste plugins isoladamente** numa instância de teste dedicada.

## 8. Produção / server

- **F24 — Rode atrás de reverse proxy** (Nginx/HAProxy) para TLS, domínios e escala. A app **não** termina TLS nem gerencia múltiplos domínios (o time do Fastify considera anti-pattern expor a app direto na internet).
- **F25 — `host: 0.0.0.0`** (já é o default do projeto) para readiness probes / containers funcionarem — o default `127.0.0.1` quebra probes.
- **F26 — Shutdown gracioso:** trate `SIGINT`/`SIGTERM` chamando `await app.close()` antes de sair (fecha conexões e roda hooks `onClose`).
- **F27 — Ajuste limites conscientemente:** `bodyLimit`, `keepAliveTimeout`, `connectionTimeout` conforme o proxy à frente.

---

**Fontes (doc oficial Fastify):** Guides/Recommendations · Guides/Plugins-Guide · Reference/Validation-and-Serialization · Guides/Testing.
