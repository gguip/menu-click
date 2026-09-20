import { Outlet, useLocation, useNavigate } from "react-router";
import { NetworkError } from "../../api/client.ts";
import { useSessionUser } from "../../auth/useMe.ts";
import { formatSecondsAgo } from "../../lib/time.ts";
import { useNow } from "../../lib/useNow.ts";
import { useOnline } from "../../lib/useOnline.ts";
import { useRestaurant } from "../restaurant/useRestaurant.ts";
import { FilterBar } from "./FilterBar.tsx";
import { Kanban } from "./Kanban.tsx";
import { isRange, useOrderFilters } from "./orderFilters.ts";
import { DeliveryAlert, EmptyOrders, OfflineNotice } from "./OrdersNotices.tsx";
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

  const offline = !online || orders.error instanceof NetworkError;
  const list = orders.data ?? [];
  const showEmpty =
    !orders.isPending &&
    list.length === 0 &&
    filters.period === "today" &&
    !isRange(filters) &&
    filters.tableId === null;

  const openOrder = (orderId: string) =>
    navigate({ pathname: `/pedidos/${orderId}`, search: location.search });

  return (
    <div className={classes.page}>
      {offline && (
        <OfflineNotice updatedAt={orders.dataUpdatedAt} now={now} onRetry={() => void orders.refetch()} />
      )}
      {deliveryAlert && <DeliveryAlert />}
      <FilterBar
        filters={filters}
        onChange={setFilters}
        tables={tables.data ?? []}
        syncLabel={
          orders.isPending
            ? "Carregando pedidos…"
            : `Atualiza sozinho · ${formatSecondsAgo(orders.dataUpdatedAt, now)}`
        }
      />
      {showEmpty ? (
        <EmptyOrders />
      ) : (
        <Kanban orders={list} loading={orders.isPending} now={now} onOpen={openOrder} />
      )}
      <Outlet />
    </div>
  );
}
