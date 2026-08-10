# Regras: Padrão de commits

Todo commit **deve** seguir este formato:

```
<tipo>(<escopo opcional>): <emoji> <mensagem>
```

Exemplos:

```
feat(products): ✨ adiciona CRUD de produtos
fix(api): 🐛 rejeita priceInCents string com 400
chore: 🔧 configura turborepo e pnpm
```

## Tipos e emojis

| Tipo       | Emoji | Quando usar                                                  |
| ---------- | ----- | ------------------------------------------------------------ |
| `feat`     | ✨    | nova funcionalidade                                          |
| `fix`      | 🐛    | correção de bug                                              |
| `hotfix`   | 🚑    | correção urgente / em produção                               |
| `chore`    | 🔧    | manutenção, configs, tarefas que não são feature nem fix     |
| `docs`     | 📝    | documentação (README, CLAUDE.md, comentários)                |
| `refactor` | ♻️    | refatoração sem mudar comportamento                          |
| `perf`     | ⚡    | melhoria de performance                                      |
| `test`     | ✅    | adiciona ou ajusta testes                                    |
| `style`    | 💄    | formatação/estilo (sem mudança de lógica)                    |
| `build`    | 📦    | build, dependências, empacotamento                           |
| `ci`       | 👷    | pipelines / integração contínua                              |
| `revert`   | ⏪    | reverte um commit anterior                                   |

## Regras da mensagem

- **Escopo** é opcional, entre parênteses: a área afetada (`api`, `products`, `restaurants`, `web`, `turbo`...). Use quando ajudar a localizar a mudança.
- **Emoji** vem logo depois dos dois-pontos, **antes** da mensagem.
- **Mensagem** em pt-BR, verbo no **presente do indicativo** ("adiciona", "corrige", "remove"), **minúscula** e **sem ponto final**.
- Curta e direta — recomendado **≤ 72 caracteres** na primeira linha.
- **Um commit = uma mudança lógica.** Não misture feature + refactor + docs no mesmo commit.

## Corpo e rodapé (opcionais)

- **Corpo**: explique o "porquê" quando não for óbvio (deixe uma linha em branco após o título).
- **Breaking change**: use `!` após o escopo e/ou um rodapé `BREAKING CHANGE:`. Ex.: `feat(api)!: ✨ muda o contrato de /restaurants`.
- **Issues**: rodapé `Closes #123` / `Refs #123`.

## Exemplos

✅ Bons:

```
feat(restaurants): ✨ adiciona rota POST /restaurants
fix(products): 🐛 rejeita priceInCents string com 400
docs: 📝 documenta gotcha de interop CJS no CLAUDE.md
chore(api): 🔧 adiciona ajv e ajv-formats
refactor(products): ♻️ extrai helper de 404
```

❌ Ruins:

```
Update file              → sem tipo, sem emoji, vago
feat: adiciona coisas    → sem emoji, mensagem vaga
fix: 🐛 Corrigido o bug. → maiúscula, ponto final e tempo verbal errado
```

## Nota — commits feitos pelo Claude Code

O trailer `Co-Authored-By: Claude ...` está **desativado** neste repo (via `attribution.commit: ""` no `.claude/settings.json`). Ou seja, os commits do Claude seguem **só** o padrão acima, sem rodapé de atribuição.
