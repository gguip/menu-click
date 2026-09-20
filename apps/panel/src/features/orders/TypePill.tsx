import type { Order } from "../../api/types.ts";
import { stageLabel, typeLabel } from "./presentation.ts";
import classes from "./TypePill.module.css";

/** Modalidade (e, na coluna Prontos, o estágio): é ela que decide o vocabulário. */
export function TypePill({ order }: { order: Pick<Order, "type" | "status"> }) {
  const stage = stageLabel(order.status);
  return (
    <span className={classes.pill}>
      <span className={`${classes.dot} ${classes[order.type]}`} aria-hidden="true" />
      {stage ? `${typeLabel(order.type)} · ${stage}` : typeLabel(order.type)}
    </span>
  );
}
