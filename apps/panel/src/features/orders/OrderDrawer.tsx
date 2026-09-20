import { Button, Drawer } from "@mantine/core";
import { IconX } from "@tabler/icons-react";
import { useLocation, useNavigate, useParams } from "react-router";
import { ApiError, describeError } from "../../api/client.ts";
import type { OrderDetail } from "../../api/types.ts";
import { useSessionUser } from "../../auth/useMe.ts";
import { formatCents } from "../../lib/money.ts";
import { orderCode } from "../../lib/orderCode.ts";
import { formatElapsed } from "../../lib/time.ts";
import { useNow } from "../../lib/useNow.ts";
import buttons from "../../ui/buttons.module.css";
import { useRestaurant } from "../restaurant/useRestaurant.ts";
import classes from "./OrderDrawer.module.css";
import { useOrderAction } from "./orderActionFlow.tsx";
import { cancelKind, cancelLabel, closedMessage, primaryAction, progressSteps } from "./orderRules.ts";
import { formatPhone, freightLine, groupOptions, itemsSubtotal, paymentLabel, whereLabel } from "./presentation.ts";
import { TypePill } from "./TypePill.tsx";
import { useOrder } from "./useOrders.ts";

function OrderDetailView({
  order,
  now,
  timeZone,
  onClose,
}: {
  order: OrderDetail;
  now: number;
  timeZone: string | undefined;
  onClose: () => void;
}) {
  const { request, busyOrderId, disabled } = useOrderAction();
  const action = primaryAction(order);
  const kind = cancelKind(order.status);
  const freight = freightLine(order);
  const closed = closedMessage(order, timeZone);
  const busy = busyOrderId === order.id;

  return (
    <div className={classes.drawer}>
      <header className={classes.header}>
        <div className={classes.headTop}>
          <span className={`${classes.code} n`}>{orderCode(order.id)}</span>
          <TypePill order={order} />
          <span className="n">{formatElapsed(order.createdAt, now)}</span>
          <button type="button" className={classes.close} aria-label="Fechar" onClick={onClose}>
            <IconX size={18} />
          </button>
        </div>
        <h2 className={classes.name}>{order.customer.name}</h2>
        <p className={classes.contact}>
          <span className="n">{formatPhone(order.customer.phone)}</span> · {whereLabel(order)}
        </p>
      </header>

      <div className={classes.body}>
        <ul className={classes.items}>
          {order.items.map((item) => (
            <li key={item.id} className={classes.item}>
              <span className={`${classes.qty} n`}>{item.quantity}×</span>
              <div>
                <span className={classes.itemName}>{item.name}</span>
                {/* Sem "+R$" por opção: o pedido não guarda a regra do grupo, e
                    em "mais caro"/"média" o preço da opção não é parcela da
                    soma (spec). O valor da linha já inclui as opções. */}
                {groupOptions(item.options).map((group) => (
                  <span key={group.groupName} className={classes.options}>
                    {group.groupName}: {group.text}
                  </span>
                ))}
              </div>
              <span className={`${classes.price} n`}>{formatCents(item.unitPriceInCents * item.quantity)}</span>
            </li>
          ))}
        </ul>

        <dl className={classes.totals}>
          <div>
            <dt>Itens</dt>
            <dd className="n">{formatCents(itemsSubtotal(order))}</dd>
          </div>
          {freight && (
            <div>
              <dt>{freight.label}</dt>
              <dd className="n">{freight.value}</dd>
            </div>
          )}
          <div className={classes.total}>
            <dt>Total</dt>
            <dd className="n">{formatCents(order.totalInCents)}</dd>
          </div>
        </dl>
        <p className={classes.payment}>{paymentLabel(order)}</p>

        <section className={classes.progress}>
          <span className="eyebrow">Andamento</span>
          <ol className={classes.steps}>
            {progressSteps(order, timeZone).map((step) => (
              <li key={step.label} className={`${classes.step} ${classes[`step_${step.state}`]}`}>
                <span className={classes.stepDot} aria-hidden="true" />
                <span>{step.label}</span>
                <span className={`${classes.stepTime} n`}>
                  {step.time ?? (step.state === "future" ? "—" : "")}
                </span>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <footer className={classes.footer}>
        {closed !== null ? (
          <p className={classes.closed}>{closed}</p>
        ) : (
          <>
            {action && (
              <Button fullWidth h={46} disabled={disabled} loading={busy} onClick={() => request(order, action.transition)}>
                {action.label}
              </Button>
            )}
            <div className={classes.footRow}>
              <span className={classes.note}>{action?.note}</span>
              {kind && (
                <Button
                  variant="default"
                  className={buttons.danger}
                  disabled={disabled || busy}
                  onClick={() => request(order, "cancel")}
                >
                  {cancelLabel(kind)}
                </Button>
              )}
            </div>
          </>
        )}
      </footer>
    </div>
  );
}

/**
 * Sem overlay e sem prender o foco: o kanban continua legível e clicável ao
 * lado, de propósito (handoff).
 */
export function OrderDrawer() {
  const { orderId = "" } = useParams();
  const me = useSessionUser();
  const restaurant = useRestaurant(me.restaurantId);
  const order = useOrder(me.restaurantId, orderId);
  const now = useNow();
  const navigate = useNavigate();
  const location = useLocation();
  const close = () => navigate({ pathname: "/pedidos", search: location.search });

  return (
    <Drawer
      opened
      onClose={close}
      position="right"
      size={472}
      padding={0}
      withOverlay={false}
      withCloseButton={false}
      lockScroll={false}
      trapFocus={false}
      closeOnClickOutside={false}
      // O título dá nome acessível ao diálogo; o cabeçalho visível é o nosso.
      title="Detalhe do pedido"
      classNames={{ header: classes.srHeader }}
    >
      {order.isPending ? (
        <p className={classes.missing}>Carregando pedido…</p>
      ) : order.isError ? (
        <p className={classes.missing}>
          {order.error instanceof ApiError && order.error.status === 404
            ? "Pedido não encontrado."
            : describeError(order.error)}
        </p>
      ) : (
        <OrderDetailView order={order.data} now={now} timeZone={restaurant.data?.timezone} onClose={close} />
      )}
    </Drawer>
  );
}
