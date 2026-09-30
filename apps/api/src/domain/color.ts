/**
 * Contraste de uma cor com o BRANCO, pela fórmula do WCAG (luminância
 * relativa). É a conta que decide se a cor da marca serve de fundo para o
 * texto branco do botão de ação no app do cliente.
 */
export const MIN_ACTION_CONTRAST = 4.5;

export const HEX_COLOR_PATTERN = "^#[0-9A-Fa-f]{6}$";

function channel(hex: string): number {
  const c = parseInt(hex, 16) / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** `#RRGGBB` → razão de contraste com `#FFFFFF` (1 a 21). */
export function contrastWithWhite(hex: string): number {
  const r = channel(hex.slice(1, 3));
  const g = channel(hex.slice(3, 5));
  const b = channel(hex.slice(5, 7));
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return 1.05 / (luminance + 0.05);
}
