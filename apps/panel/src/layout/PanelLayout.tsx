import { Outlet, useMatches } from "react-router";
import { useSessionUser } from "../auth/useMe.ts";
import { useNewOrderAlert } from "../features/orders/useNewOrderAlert.ts";
import { usePolledRestaurant } from "../features/restaurant/useRestaurant.ts";
import { Header } from "./Header.tsx";
import classes from "./PanelLayout.module.css";
import { PauseBanner } from "./PauseBanner.tsx";
import { Rail } from "./Rail.tsx";

/** Toda rota do painel declara `handle: { title }`; é o título do header. */
export type RouteHandle = { title: string };

function useRouteTitle(): string {
  const matches = useMatches();
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const handle = matches[index].handle as RouteHandle | undefined;
    if (handle?.title) return handle.title;
  }
  return "";
}

export function PanelLayout() {
  const me = useSessionUser();
  // O shell é o único dono do polling do restaurante (FIX 3 da revisão);
  // OrdersPage e o cabeçalho do drawer só leem esta mesma query.
  const restaurant = usePolledRestaurant(me.restaurantId);
  const title = useRouteTitle();
  const paused = restaurant.data?.acceptingOrders === false;
  const alert = useNewOrderAlert(me.restaurantId);

  return (
    <div className={classes.shell}>
      <Rail
        restaurant={restaurant.data}
        me={me}
        pendingCount={alert.pendingCount}
        soundBlocked={alert.soundBlocked}
        onEnableSound={alert.enableSound}
      />
      <div className={classes.main}>
        <Header title={title} restaurantId={me.restaurantId} restaurant={restaurant.data} />
        {paused && <PauseBanner />}
        <div className={classes.content}>
          <Outlet />
        </div>
      </div>
    </div>
  );
}
