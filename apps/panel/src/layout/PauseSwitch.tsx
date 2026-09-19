import type { Restaurant } from "../api/types.ts";
import { useSetAcceptingOrders } from "../features/restaurant/useRestaurant.ts";
import classes from "./PauseSwitch.module.css";

/**
 * O botão de "cozinha afogada". Global e sempre visível, de propósito: quem
 * precisa dele está com a cozinha em colapso e não vai procurar em
 * configurações. Não mexe no horário cadastrado.
 */
export function PauseSwitch({
  restaurantId,
  restaurant,
}: {
  restaurantId: string;
  restaurant: Restaurant | undefined;
}) {
  const mutation = useSetAcceptingOrders(restaurantId);
  // Nada a mostrar (nem desabilitado) antes de saber o estado real: um
  // interruptor clicável antes de carregar mentiria sobre o que vai mudar.
  if (restaurant === undefined) return null;
  const accepting = restaurant.acceptingOrders;
  return (
    <div className={classes.wrap}>
      <button
        type="button"
        role="switch"
        aria-checked={accepting}
        aria-label="Aceitando pedidos"
        disabled={mutation.isPending}
        className={accepting ? classes.pill : `${classes.pill} ${classes.paused}`}
        onClick={() => mutation.mutate(!accepting)}
      >
        <span className={classes.track} aria-hidden="true">
          <span className={classes.knob} />
        </span>
        {accepting ? "Aceitando pedidos" : "Pausada"}
      </button>
      {mutation.isError && (
        <span role="alert" className={classes.error}>
          Não mudou — tente de novo
        </span>
      )}
    </div>
  );
}
