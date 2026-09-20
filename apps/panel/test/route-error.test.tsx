import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Outlet } from "react-router";
import { RouteError } from "../src/layout/RouteError.tsx";
import { renderRoutes } from "./render.tsx";

function Shell() {
  return (
    <div>
      <Outlet />
    </div>
  );
}

function Boom(): never {
  throw new Error("quebrou de propósito, para o teste");
}

const routes = [
  {
    element: <Shell />,
    errorElement: <RouteError />,
    children: [{ path: "/pedidos", element: <Boom /> }],
  },
];

describe("RouteError", () => {
  it("renderiza no lugar da tela em branco quando uma rota filha lança", async () => {
    renderRoutes(routes, "/pedidos");
    expect(await screen.findByText("Algo deu errado")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Recarregar" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ir para os pedidos" })).toBeTruthy();
  });
});
