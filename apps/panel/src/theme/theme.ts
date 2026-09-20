import {
  createTheme,
  type CSSVariablesResolver,
  type MantineColorsTuple,
} from "@mantine/core";
import { darkTokens, lightTokens, tokenVariables, type TokenName } from "./tokens.ts";

// Shade 6 = accent do tema claro; shade 3 = accent do escuro; 7 = accent-hi.
const olive: MantineColorsTuple = [
  "#EDF1E7",
  "#DCE5D2",
  "#CBD8BD",
  "#93B375",
  "#7A9A5F",
  "#5F814B",
  "#4A6B3A",
  "#3C5A2D",
  "#2F4723",
  "#23351A",
];

const FONT = "Figtree, ui-sans-serif, system-ui, sans-serif";
const NO_MOTION = { transitionProps: { duration: 0 } };

export const theme = createTheme({
  primaryColor: "olive",
  primaryShade: { light: 6, dark: 3 },
  autoContrast: true,
  colors: { olive },
  fontFamily: FONT,
  headings: { fontFamily: FONT },
  defaultRadius: "sm",
  radius: { xs: "4px", sm: "6px", md: "10px", lg: "10px", xl: "10px" },
  // "Sem sombra em nenhum lugar": separação é borda de 1px + troca de superfície.
  shadows: { xs: "none", sm: "none", md: "none", lg: "none", xl: "none" },
  components: {
    // O painel fica aberto o dia inteiro: nada anima.
    Modal: { defaultProps: NO_MOTION },
    Drawer: { defaultProps: NO_MOTION },
    Menu: { defaultProps: NO_MOTION },
    Popover: { defaultProps: NO_MOTION },
    Skeleton: { defaultProps: { animate: false } },
  },
});

function schemeVariables(tokens: Record<TokenName, string>): Record<string, string> {
  return {
    ...tokenVariables(tokens),
    // `--mantine-color-body` é o fundo de Modal, Paper, Drawer: vira a
    // superfície. O fundo da janela é o `bg`, aplicado no body (global.css).
    "--mantine-color-body": tokens.surface,
    "--mantine-color-text": tokens.ink,
    "--mantine-color-dimmed": tokens.ink3,
    "--mantine-color-placeholder": tokens.ink3,
    "--mantine-color-default": tokens.surface,
    "--mantine-color-default-hover": tokens.surface3,
    "--mantine-color-default-color": tokens.ink,
    "--mantine-color-default-border": tokens.line,
    "--mantine-color-error": tokens.danger,
  };
}

export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {},
  light: schemeVariables(lightTokens),
  dark: schemeVariables(darkTokens),
});
