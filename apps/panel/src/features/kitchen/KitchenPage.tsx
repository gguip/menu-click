import { Button } from "@mantine/core";
import { Link } from "react-router";
import { describeError } from "../../api/client.ts";
import type { Order } from "../../api/types.ts";
import { useSessionUser } from "../../auth/useMe.ts";
import { orderCode } from "../../lib/orderCode.ts";
import { formatElapsed } from "../../lib/time.ts";
import { useNow } from "../../lib/useNow.ts";
import { useOnline } from "../../lib/useOnline.ts";
import { OrderActionProvider, useOrderAction } from "../orders/orderActionFlow.tsx";
import { groupOptions, typeLabel } from "../orders/presentation.ts";
import { useNewOrderAlert } from "../orders/useNewOrderAlert.ts";
import { byArrival, KITCHEN_COLUMNS, type KitchenColumnId, kitchenAction } from "./kitchen.ts";
import classes from "./KitchenPage.module.css";
import { useDoingOrders, useOrderItems } from "./useKitchen.ts";

/**
 * Nada de dinheiro aqui: preço, total, frete, forma de pagamento, telefone e
 * nome do cliente ficam de fora (handoff). A cozinha não decide dinheiro, e
 * cada dado a mais é uma linha para varrer com o olho no pico.
 */
function KitchenCard({
  restaurantId,
  order,
  column,
  now,
}: {
  restaurantId: string;
  order: Order;
  column: KitchenColumnId;
  now: number;
}) {
  const items = useOrderItems(restaurantId, order.id);
  const action = kitchenAction(order);
  const { request, busyOrderId, disabled } = useOrderAction();
  const code = orderCode(order.id);
  const where = order.type === "dine_in" && order.table !== null ? ` · ${order.table.label}` : "";

  return (
    <article
      className={`${classes.card} ${column === "new" ? classes.card_new : ""}`}
      aria-label={`Pedido ${code}`}
    >
      <header className={classes.cardHead}>
        <span className={`${classes.code} n`}>{code}</span>
        <span className={classes.type}>
          {typeLabel(order.type)}
          {where}
        </span>
        <span className={`${classes.time} n`}>{formatElapsed(order.createdAt, now)}</span>
      </header>

      {items.data === undefined ? (
        items.isError ? (
          <div className={classes.itemsError}>
            <p className={classes.itemsNote}>Não foi possível carregar os itens.</p>
            <Button variant="default" onClick={() => void items.refetch()}>
              Tentar de novo
            </Button>
          </div>
        ) : (
          <p className={classes.itemsNote}>Carregando itens…</p>
        )
      ) : (
        <ul className={classes.items}>
          {items.data.map((item) => (
            <li key={item.id} className={classes.item}>
              <span className={`${classes.qty} n`}>{item.quantity}×</span>
              <span>{item.name}</span>
              {groupOptions(item.options).map((group) => (
                <span key={group.groupName} className={classes.option}>
                  {group.groupName}: {group.text}
                </span>
              ))}
            </li>
          ))}
        </ul>
      )}

      {action !== null && (
        <Button
          h={54}
          fullWidth
          loading={busyOrderId === order.id}
          disabled={disabled || (busyOrderId !== null && busyOrderId !== order.id)}
          onClick={() => request(order, action.transition)}
        >
          {action.label}
        </Button>
      )}
    </article>
  );
}

function KitchenColumn({
  restaurantId,
  id,
  title,
  empty,
  orders,
  error,
  partialError,
  now,
}: {
  restaurantId: string;
  id: KitchenColumnId;
  title: string;
  empty: string;
  orders: Order[] | undefined;
  error: unknown;
  partialError?: unknown;
  now: number;
}) {
  return (
    <section className={classes.column} aria-label={title}>
      <h2 className={classes.columnHead}>
        <span className={`${classes.dot} ${classes[`dot_${id}`]}`} aria-hidden="true" />
        {title}
        {orders !== undefined && <span className="n">{orders.length}</span>}
      </h2>
      {orders === undefined ? (
        <p className={error ? classes.error : classes.itemsNote}>
          {error ? describeError(error) : "Carregando pedidos…"}
        </p>
      ) : (
        <>
          {partialError != null && (
            <p className={classes.error}>{`Parte da lista não carregou: ${describeError(partialError)}`}</p>
          )}
          {orders.length === 0 ? (
            <p className={classes.empty}>{empty}</p>
          ) : (
            orders.map((order) => (
              <KitchenCard key={order.id} restaurantId={restaurantId} order={order} column={id} now={now} />
            ))
          )}
        </>
      )}
    </section>
  );
}

export function KitchenPage() {
  const { restaurantId } = useSessionUser();
  // A cozinha está fora da casca, então monta o aviso de pedido novo por
  // conta própria — bipe e título da aba continuam valendo aqui. A lista
  // que ele vigia é a mesma de "Entraram agora": nenhuma requisição a mais.
  const alert = useNewOrderAlert(restaurantId);
  const doing = useDoingOrders(restaurantId);
  const online = useOnline();
  const now = useNow();

  const byColumn: Record<
    KitchenColumnId,
    { orders: Order[] | undefined; error: unknown; partialError?: unknown }
  > = {
    new: {
      orders: alert.pendingOrders === undefined ? undefined : byArrival(alert.pendingOrders),
      error: alert.pendingError,
    },
    doing: { orders: doing.orders, error: doing.error, partialError: doing.partialError },
  };

  return (
    <OrderActionProvider restaurantId={restaurantId} disabled={!online} mode="kitchen">
      <div className={classes.page}>
        <header className={classes.top}>
          <div>
            <h1 className={classes.title}>Modo cozinha</h1>
            <p className={classes.note}>
              Tela para o tablet da bancada: só o que a cozinha precisa fazer. Sem preço, sem forma de
              pagamento, sem telefone — tipografia grande para leitura a um metro.
            </p>
          </div>
          <div className={classes.topActions}>
            {alert.soundBlocked && (
              <Button variant="default" onClick={alert.enableSound}>
                Som desligado · Ativar som
              </Button>
            )}
            <Button component={Link} to="/pedidos" variant="default">
              Sair do modo cozinha
            </Button>
          </div>
        </header>
        <div className={classes.columns}>
          {KITCHEN_COLUMNS.map((column) => (
            <KitchenColumn
              key={column.id}
              restaurantId={restaurantId}
              id={column.id}
              title={column.title}
              empty={column.empty}
              orders={byColumn[column.id].orders}
              error={byColumn[column.id].error}
              partialError={byColumn[column.id].partialError}
              now={now}
            />
          ))}
        </div>
      </div>
    </OrderActionProvider>
  );
}
