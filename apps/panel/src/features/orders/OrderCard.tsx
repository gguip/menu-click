import type { Order } from "../../api/types.ts";
import { formatCents } from "../../lib/money.ts";
import { orderCode } from "../../lib/orderCode.ts";
import { formatElapsed } from "../../lib/time.ts";
import classes from "./OrderCard.module.css";
import { displayName } from "./orderRules.ts";
import { isUrgent, paymentLabel } from "./presentation.ts";
import { TypePill } from "./TypePill.tsx";

export function OrderCard({
  order,
  now,
  onOpen,
}: {
  order: Order;
  now: number;
  onOpen: (orderId: string) => void;
}) {
  const code = orderCode(order.id);
  return (
    <article
      className={`${classes.card} ${classes[`state_${order.status}`]}`}
      aria-label={`Pedido ${code}`}
      tabIndex={0}
      onClick={() => onOpen(order.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter") onOpen(order.id);
      }}
    >
      <div className={classes.topRow}>
        <span className={`${classes.code} n`}>{code}</span>
        <span className={`${classes.time} ${isUrgent(order, now) ? classes.timeWarn : ""} n`}>
          {formatElapsed(order.createdAt, now)}
        </span>
      </div>
      <strong className={classes.name}>{displayName(order)}</strong>
      <TypePill order={order} />
      <div className={classes.moneyRow}>
        <span className={classes.payment}>{paymentLabel(order)}</span>
        <span className={`${classes.total} n`}>{formatCents(order.totalInCents)}</span>
      </div>
    </article>
  );
}
