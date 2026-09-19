/**
 * Os tokens de cor do handoff (docs/design/painel-da-loja/README.md), nos
 * dois temas. É o ÚNICO lugar com hex no painel: a tela lê
 * `var(--mc-<nome>)`. Regra do handoff, mais importante que os valores: um
 * acento só (oliva); âmbar só para "exige ação agora"; vermelho só para
 * destrutivo e falha.
 */
export const lightTokens = {
  bg: "#F5F4F1",
  surface: "#FFFFFF",
  surface2: "#FAF9F7",
  surface3: "#EFEDE9",
  line: "#E4E1DB",
  "line-hi": "#CFCAC2",
  ink: "#1B1A17",
  ink2: "#5F5A52",
  ink3: "#6E6960",
  accent: "#4A6B3A",
  "accent-hi": "#3C5A2D",
  "accent-soft": "#EDF1E7",
  "accent-line": "#CBD8BD",
  "on-accent": "#FFFFFF",
  warn: "#8A5A12",
  "warn-strong": "#C4841F",
  "warn-soft": "#FBF2E2",
  "warn-line": "#E8D3A8",
  danger: "#98362A",
  "danger-soft": "#FAEDEB",
  "danger-line": "#E7C6C0",
  // ponto da pill "Retirada" — o handoff dá um valor só, para os dois temas
  pickup: "#6B7B8C",
  // fundo do modal de confirmação
  overlay: "rgba(20, 18, 14, 0.42)",
} as const;

export type TokenName = keyof typeof lightTokens;

export const darkTokens: Record<TokenName, string> = {
  bg: "#15140F",
  surface: "#1E1D19",
  surface2: "#242320",
  surface3: "#2B2A25",
  line: "#332F29",
  "line-hi": "#443F37",
  ink: "#EFEDE7",
  ink2: "#A8A29A",
  ink3: "#98928A",
  accent: "#93B375",
  "accent-hi": "#A6C489",
  "accent-soft": "#232A1C",
  "accent-line": "#39452C",
  "on-accent": "#14170F",
  warn: "#DFAE5E",
  "warn-strong": "#E8BE74",
  "warn-soft": "#2B2417",
  "warn-line": "#4A3D22",
  danger: "#E08878",
  "danger-soft": "#2C1D19",
  "danger-line": "#4E2F27",
  pickup: "#6B7B8C",
  overlay: "rgba(0, 0, 0, 0.55)",
};

export function tokenVariables(tokens: Record<TokenName, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(tokens).map(([name, value]) => [`--mc-${name}`, value]),
  );
}
