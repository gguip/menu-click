import type { Restaurant } from "../api/types.ts";
import { useTodaySummary } from "../features/orders/useSummary.ts";
import { formatCents } from "../lib/money.ts";
import { CopyMenuLink } from "./CopyMenuLink.tsx";
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
  menuOpen,
  onOpenMenu,
}: {
  title: string;
  restaurantId: string;
  restaurant: Restaurant | undefined;
  menuOpen: boolean;
  onOpenMenu: () => void;
}) {
  const summary = useTodaySummary(restaurantId).data;
  return (
    <header className={classes.header}>
      <div className={classes.left}>
        {/* só aparece em tela estreita, onde o menu lateral vira gaveta */}
        <button
          type="button"
          className={classes.menu}
          aria-label="Abrir menu"
          aria-expanded={menuOpen}
          onClick={onOpenMenu}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
        <h1 className={classes.title}>{title}</h1>
      </div>
      <div className={classes.right}>
        {/* "Aceitos hoje", não "Pedidos": conta de aceito em diante, igual ao
            Resumo — o rótulo antigo contava os chegados e divergia. */}
        <div className={classes.indicators}>
          <Indicator label="Aceitos hoje" value={summary ? String(summary.revenueOrderCount) : "—"} />
          <Indicator label="Faturamento" value={summary ? formatCents(summary.revenueInCents) : "—"} />
          <Indicator
            label="Ticket médio"
            value={summary ? formatCents(summary.averageTicketInCents) : "—"}
          />
          <span className={classes.divider} aria-hidden="true" />
        </div>
        <CopyMenuLink menuUrl={restaurant?.menuUrl} />
        <PauseSwitch restaurantId={restaurantId} restaurant={restaurant} />
      </div>
    </header>
  );
}
