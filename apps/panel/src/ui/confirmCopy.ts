/** O conteúdo de uma confirmação: quem decide o texto é a regra, não o modal. */
export type ConfirmCopy = {
  title: string;
  body: string;
  /** Faixa âmbar: a consequência que não pode passar despercebida. */
  warn?: string;
  cta: string;
  tone: "accent" | "danger";
};
