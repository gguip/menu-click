import type { Order } from "../../api/types.ts";
import classes from "./Kanban.module.css";
import { OrderCard } from "./OrderCard.tsx";
import { COLUMNS, groupByColumn } from "./orderRules.ts";

/** Esqueleto SEM animação: três barras de 11/15/11 px (handoff). */
function CardSkeleton() {
  return (
    <div className={classes.skeleton} aria-hidden="true">
      <span className={classes.bar} style={{ height: 11, width: "45%" }} />
      <span className={classes.bar} style={{ height: 15, width: "75%" }} />
      <span className={classes.bar} style={{ height: 11, width: "60%" }} />
    </div>
  );
}

export function Kanban({
  orders,
  loading,
  now,
  onOpen,
}: {
  orders: readonly Order[];
  loading: boolean;
  now: number;
  onOpen: (orderId: string) => void;
}) {
  const groups = groupByColumn(orders);
  return (
    <div className={classes.board}>
      {COLUMNS.map((column) => {
        const items = groups[column.id];
        const warn = column.id === "new" && items.length > 0;
        return (
          // `aria-label` só vem depois de carregar: um <section> sem nome
          // acessível não vira landmark "region" (mapeamento ARIA padrão),
          // então a coluna só aparece para `getByRole("region")` no MESMO
          // commit em que os pedidos já estão prontos — sem essa condição,
          // o rótulo apareceria um commit antes dos dados (esqueleto ainda
          // na tela), e uma consulta síncrona logo depois do `findByRole`
          // pegaria o esqueleto em vez do pedido.
          <section key={column.id} className={classes.column} aria-label={loading ? undefined : column.title}>
            <header className={classes.header}>
              <span className={`${classes.dot} ${classes[`dot_${column.id}`]}`} aria-hidden="true" />
              <h2 className={classes.title}>{column.title}</h2>
              <span className={`${classes.count} ${warn ? classes.countWarn : ""} n`}>
                {loading ? "—" : items.length}
              </span>
            </header>
            <div className={classes.body}>
              {loading ? (
                <>
                  <CardSkeleton />
                  <CardSkeleton />
                </>
              ) : items.length === 0 ? (
                <p className={classes.empty}>{column.empty}</p>
              ) : (
                items.map((order) => <OrderCard key={order.id} order={order} now={now} onOpen={onOpen} />)
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
