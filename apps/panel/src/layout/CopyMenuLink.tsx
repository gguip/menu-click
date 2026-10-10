import { Button } from "@mantine/core";
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
      aria-label="Copiar link do cardápio"
      onClick={() => {
        // `clipboard` não existe em página sem HTTPS: o `?.` cai no mesmo aviso
        const copy = navigator.clipboard?.writeText(menuUrl) ?? Promise.reject(new Error("sem clipboard"));
        copy.then(notifyLinkCopied, () => notifyLinkNotCopied(menuUrl));
      }}
    >
      Copiar link
    </Button>
  );
}
