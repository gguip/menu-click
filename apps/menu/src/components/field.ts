/**
 * O campo de texto do app, um só: fundo branco, borda fina e, no foco, borda
 * e anel na cor de ação (2px aparentes). O handoff desenhava a busca como
 * pílula cinza sem borda e os campos do finalizar como caixa branca — duas
 * linguagens na mesma tela; vale a dos campos, que são a maioria.
 *
 * O texto dentro é sempre 16px (`text-base`): abaixo disso o Safari do iPhone
 * dá zoom na página ao focar o campo.
 */
export const FIELD_BOX = "rounded-field border border-line-strong bg-paper";

/** Para o próprio `input`/`textarea`. */
export const FIELD_FOCUS = "focus:border-action focus:ring-1 focus:ring-action focus:outline-none";

/** Para o rótulo que embrulha um campo com ícone (a busca). */
export const FIELD_FOCUS_WITHIN = "focus-within:border-action focus-within:ring-1 focus-within:ring-action";

export const FIELD_TEXT = "text-base text-ink placeholder:text-ink-3";
