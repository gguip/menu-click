import { Outlet, useMatches } from "react-router";
import { useSessionUser } from "../auth/useMe.ts";
import { useRestaurant } from "../features/restaurant/useRestaurant.ts";
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
  const restaurant = useRestaurant(me.restaurantId);
  const title = useRouteTitle();
  const paused = restaurant.data?.acceptingOrders === false;

  return (
    <div className={classes.shell}>
      <Rail restaurant={restaurant.data} me={me} />
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
