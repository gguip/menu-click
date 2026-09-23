import QRCode from "react-qr-code";
import type { Table } from "../../api/types.ts";
import classes from "./TablesPage.module.css";

/**
 * A folha vive na PRÓPRIA página e só aparece no `@media print`: o botão
 * chama `window.print()`, então a prévia do navegador é exatamente o que vai
 * para o papel — e salvar em PDF é o próprio diálogo do navegador, sem
 * biblioteca nenhuma.
 */
export function PrintSheet({ storeName, tables }: { storeName: string; tables: Table[] }) {
  return (
    <div className={classes.sheet} data-testid="folha-de-impressao">
      {tables.map((table) => (
        <div key={table.id} className={classes.sticker} data-testid="adesivo">
          <span className={classes.stickerStore}>{storeName}</span>
          <QRCode value={table.qrUrl} size={180} level="Q" />
          <strong className={classes.stickerLabel}>{table.label}</strong>
          <span className={classes.stickerUrl}>{table.qrUrl}</span>
        </div>
      ))}
    </div>
  );
}
