import { Button } from "@mantine/core";
import type { Order } from "../../api/types.ts";
import { formatCents } from "../../lib/money.ts";
import { orderCode } from "../../lib/orderCode.ts";
import { formatElapsed } from "../../lib/time.ts";
import { useOrderAction } from "./orderActionFlow.tsx";
import classes from "./OrderCard.module.css";
import { displayName, primaryAction } from "./orderRules.ts";
import { isUrgent, paymentLabel } from "./presentation.ts";
import { TypePill } from "./TypePill.tsx";

/** Os botões param a propagação: aceitar não pode abrir o drawer. */
function CardActions({ order }: { order: Order }) {
  const { request, busyOrderId, disabled } = useOrderAction();
  const action = primaryAction(order);
  if (action === null) return null;
  const busy = busyOrderId === order.id;
  const isNew = order.status === "pending";
  return (
    <div
      className={classes.actions}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <Button
        className={classes.primaryAction}
        h={38}
        variant={isNew ? "filled" : "default"}
        disabled={disabled}
        loading={busy}
        onClick={() => request(order, action.transition)}
      >
        {action.cardLabel}
      </Button>
      {isNew && (
        <Button
          className={classes.secondaryAction}
          variant="default"
          h={38}
          disabled={disabled || busy}
          onClick={() => request(order, "cancel")}
        >
          Recusar
        </Button>
      )}
    </div>
  );
}

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
      <CardActions order={order} />
    </article>
  );
}
