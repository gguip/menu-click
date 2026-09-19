import classes from "./PanelLayout.module.css";

/** A segunda frase existe para tirar o medo de ter desconfigurado o horário. */
export function PauseBanner() {
  return (
    <div className={classes.banner} role="status">
      <strong>Pausada</strong> ·{" "}
      <span>A loja não está recebendo pedidos novos. O horário cadastrado não foi alterado.</span>
    </div>
  );
}
