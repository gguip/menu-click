import { Button } from "@mantine/core";
import classes from "./CopyMenuLink.module.css";
import { notifyLinkCopied, notifyLinkNotCopied } from "../lib/notify.tsx";

/**
 * Copia o link do cardápio, para a loja mandar ao cliente (entrega e
 * retirada). A URL vem pronta da API, como o `qrUrl` das mesas: o painel
 * nunca monta endereço do cardápio.
 */
export function CopyMenuLink({ menuUrl }: { menuUrl: string | undefined }) {
  if (menuUrl === undefined) return null;
  return (
    <Button
      variant="default"
      size="sm"
      className={classes.button}
      aria-label="Copiar link do cardápio"
      onClick={() => {
        // `clipboard` não existe em página sem HTTPS: o `?.` cai no mesmo aviso
        const copy = navigator.clipboard?.writeText(menuUrl) ?? Promise.reject(new Error("sem clipboard"));
        copy.then(notifyLinkCopied, () => notifyLinkNotCopied(menuUrl));
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
      </svg>
      {/* em tela estreita sobra só o ícone; o nome continua no `aria-label` */}
      <span className={classes.text}>Copiar link</span>
    </Button>
  );
}
