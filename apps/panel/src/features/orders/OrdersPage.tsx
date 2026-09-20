import { Outlet, useLocation, useNavigate } from "react-router";
import { NetworkError } from "../../api/client.ts";
import { useSessionUser } from "../../auth/useMe.ts";
import { formatSecondsAgo } from "../../lib/time.ts";
import { useNow } from "../../lib/useNow.ts";
import { useOnline } from "../../lib/useOnline.ts";
import { useRestaurant } from "../restaurant/useRestaurant.ts";
import { FilterBar } from "./FilterBar.tsx";
import { Kanban } from "./Kanban.tsx";
import { OrderActionProvider } from "./orderActionFlow.tsx";
import { isRange, useOrderFilters } from "./orderFilters.ts";
import { DeliveryAlert, EmptyOrders, OfflineNotice, OrdersLoadError, TruncatedOrdersNotice } from "./OrdersNotices.tsx";
import classes from "./OrdersPage.module.css";
import { useDeliveryAlert, useOrders, useTables } from "./useOrders.ts";

export function OrdersPage() {
  const me = useSessionUser();
  const restaurant = useRestaurant(me.restaurantId);
  const [filters, setFilters] = useOrderFilters();
  const orders = useOrders(me.restaurantId, filters);
  const tables = useTables(me.restaurantId);
  const deliveryAlert = useDeliveryAlert(me.restaurantId, restaurant.data);
  const online = useOnline();
  const now = useNow();
  const navigate = useNavigate();
  const location = useLocation();

  const networkError = orders.error instanceof NetworkError;
  const offline = !online || networkError;
  // Falha de verdade (429, 500, 403...) — nunca NetworkError, que já tem o
  // próprio aviso em OfflineNotice, e nunca junto de "sem internet": os dois
  // avisos ao mesmo tempo não ajudam ninguém.
  const showError = !offline && orders.isError;
  const list = orders.data?.items ?? [];
  const truncated = orders.data?.truncated === true;
  const showEmpty =
    // isSuccess, não !isPending: uma falha no primeiro carregamento também
    // deixa isPending false, e mostrar "Nenhum pedido ainda hoje" ali seria
    // afirmar que o dia está vazio quando a API só não respondeu (FIX 1).
    orders.isSuccess &&
    list.length === 0 &&
    filters.period === "today" &&
    !isRange(filters) &&
    filters.tableId === null;

  const openOrder = (orderId: string) =>
    navigate({ pathname: `/pedidos/${orderId}`, search: location.search });

  return (
    <OrderActionProvider restaurantId={me.restaurantId} disabled={offline}>
      <div className={classes.page}>
        {offline && (
          <OfflineNotice updatedAt={orders.dataUpdatedAt} now={now} onRetry={() => void orders.refetch()} />
        )}
        {deliveryAlert && <DeliveryAlert />}
        {truncated && <TruncatedOrdersNotice />}
        <FilterBar
          filters={filters}
          onChange={setFilters}
          tables={tables.data ?? []}
          syncLabel={
            // dataUpdatedAt, não isPending: com keepPreviousData, isPending só
            // é true antes do primeiro sucesso — mas antes desse primeiro
            // sucesso é justamente quando não há "há N s" nenhum para contar
            // (formatSecondsAgo(0, now) lia "há 1789537302 s").
            orders.dataUpdatedAt > 0
              ? `Atualiza sozinho · ${formatSecondsAgo(orders.dataUpdatedAt, now)}`
              : "Carregando pedidos…"
          }
        />
        {showError ? (
          <OrdersLoadError error={orders.error} onRetry={() => void orders.refetch()} />
        ) : showEmpty ? (
          <EmptyOrders />
        ) : (
          <Kanban orders={list} loading={orders.isPending} now={now} onOpen={openOrder} />
        )}
        <Outlet />
      </div>
    </OrderActionProvider>
  );
}
