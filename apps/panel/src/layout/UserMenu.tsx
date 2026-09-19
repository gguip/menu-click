import { Menu, useComputedColorScheme, useMantineColorScheme } from "@mantine/core";
import type { Me } from "../api/types.ts";
import { useLogout } from "../auth/useLogout.ts";
import classes from "./UserMenu.module.css";

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

/**
 * Rodapé do rail. "Sair" e o tema são adição ao handoff, que não tem logout
 * em lugar nenhum (spec, tabela de divergências).
 */
export function UserMenu({ me }: { me: Me }) {
  const { setColorScheme } = useMantineColorScheme();
  const scheme = useComputedColorScheme("light");
  const logoutMutation = useLogout();

  return (
    <Menu position="top-start" width={200}>
      <Menu.Target>
        <button type="button" className={classes.user} aria-label="Menu da conta">
          <span className={classes.avatar}>{initials(me.name)}</span>
          <span className={classes.who}>
            <span className={classes.name}>{me.name}</span>
            <span className={classes.role}>{me.role === "owner" ? "Dono" : "Equipe"}</span>
          </span>
        </button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item onClick={() => setColorScheme(scheme === "dark" ? "light" : "dark")}>
          {scheme === "dark" ? "Tema claro" : "Tema escuro"}
        </Menu.Item>
        <Menu.Item onClick={() => logoutMutation.mutate()}>Sair</Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
