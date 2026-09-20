import type { Restaurant } from "../api/types.ts";
import { useTodaySummary } from "../features/orders/useSummary.ts";
import { formatCents } from "../lib/money.ts";
import classes from "./Header.module.css";
import { PauseSwitch } from "./PauseSwitch.tsx";

function Indicator({ label, value }: { label: string; value: string }) {
  return (
    <div className={classes.indicator}>
      <span className={classes.eyebrow}>{label}</span>
      <span className={`${classes.value} n`}>{value}</span>
    </div>
  );
}

export function Header({
  title,
  restaurantId,
  restaurant,
}: {
  title: string;
  restaurantId: string;
  restaurant: Restaurant | undefined;
}) {
  const summary = useTodaySummary(restaurantId).data;
  return (
    <header className={classes.header}>
      <h1 className={classes.title}>{title}</h1>
      <div className={classes.right}>
        {/* "Aceitos hoje", não "Pedidos": conta de aceito em diante, igual ao
            Resumo — o rótulo antigo contava os chegados e divergia. */}
        <Indicator label="Aceitos hoje" value={summary ? String(summary.revenueOrderCount) : "—"} />
        <Indicator label="Faturamento" value={summary ? formatCents(summary.revenueInCents) : "—"} />
        <Indicator
          label="Ticket médio"
          value={summary ? formatCents(summary.averageTicketInCents) : "—"}
        />
        <span className={classes.divider} aria-hidden="true" />
        <PauseSwitch restaurantId={restaurantId} restaurant={restaurant} />
      </div>
    </header>
  );
}
