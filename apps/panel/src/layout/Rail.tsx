import { NavLink } from "react-router";
import type { Me, Restaurant } from "../api/types.ts";
import classes from "./Rail.module.css";
import { UserMenu } from "./UserMenu.tsx";

// O rail mostra SÓ o que existe (spec): cada tela entra aqui na task dela.
const NAV_GROUPS: { title: string; items: { to: string; label: string }[] }[] = [
  {
    title: "Operação",
    items: [
      { to: "/pedidos", label: "Pedidos" },
      { to: "/resumo", label: "Resumo do dia" },
      { to: "/produtos", label: "Produtos" },
      { to: "/secoes", label: "Seções" },
      { to: "/grupos-de-opcoes", label: "Grupos de opções" },
    ],
  },
  {
    title: "Configuração",
    items: [
      { to: "/modalidades", label: "Modalidades" },
      { to: "/entrega", label: "Entrega" },
      { to: "/horario", label: "Horário" },
      { to: "/mesas", label: "Mesas e QR" },
      { to: "/dados-da-loja", label: "Dados da loja" },
    ],
  },
];

function navClass({ isActive }: { isActive: boolean }): string {
  return isActive ? `${classes.item} ${classes.active}` : classes.item;
}

export function Rail({
  restaurant,
  me,
  pendingCount,
  soundBlocked,
  onEnableSound,
}: {
  restaurant: Restaurant | undefined;
  me: Me;
  pendingCount: number;
  soundBlocked: boolean;
  onEnableSound: () => void;
}) {
  const paused = restaurant?.acceptingOrders === false;
  return (
    <nav className={classes.rail} aria-label="Navegação do painel">
      <div className={classes.top}>
        <strong className={classes.store}>{restaurant?.name ?? ""}</strong>
        {/* "Aberta · fecha 23:30" do handoff fica para quando a API expuser
            isOpen e o próximo fechamento (pendência da spec). */}
        <span className={classes.status}>
          <span className={classes.dot} aria-hidden="true" />
          {paused ? "Pausada agora" : "Aceitando pedidos"}
        </span>
        {soundBlocked && (
          <button type="button" className={classes.sound} onClick={onEnableSound}>
            Som desligado · Ativar som
          </button>
        )}
      </div>
      <div className={classes.nav}>
        {NAV_GROUPS.map((group) => (
          <div key={group.title} className={classes.group}>
            <span className={classes.groupTitle}>{group.title}</span>
            {group.items.map((item) => (
              <NavLink key={item.to} to={item.to} className={navClass}>
                {item.label}
                {item.to === "/pedidos" && (
                  <span className={`${classes.badge} ${pendingCount > 0 ? classes.badgeWarn : ""} n`}>
                    {pendingCount}
                  </span>
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </div>
      <div className={classes.footer}>
        <UserMenu me={me} />
      </div>
    </nav>
  );
}
