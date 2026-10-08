import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SaveBar } from "../src/ui/SaveBar.tsx";
import { renderRoutes } from "./render.tsx";

// A SaveBar usa o `useBlocker` do aviso de alteração não salva, que só existe
// num router de dados: o app sempre tem um, e o teste também precisa.
function renderBar(ui: React.ReactElement) {
  return renderRoutes([{ path: "/", element: ui }], "/");
}

describe("SaveBar", () => {
  it("sem alteração, não avisa", () => {
    renderBar(<SaveBar dirty={false} saveLabel="Salvar" onSave={() => {}} cancel={{ onClick: () => {} }} />);
    expect(screen.queryByText("Alterações não salvas")).toBeNull();
  });

  it("com alteração, avisa", () => {
    renderBar(<SaveBar dirty saveLabel="Salvar" onSave={() => {}} cancel={{ onClick: () => {} }} />);
    expect(screen.getByText("Alterações não salvas")).toBeTruthy();
  });

  it("chama onSave e onClick do cancelar", () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    renderBar(<SaveBar dirty saveLabel="Salvar horário" onSave={onSave} cancel={{ onClick: onCancel }} />);
    fireEvent.click(screen.getByRole("button", { name: "Salvar horário" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onSave).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  // salvar com imagem leva segundos: cancelar no meio desfazia a tela, e o
  // salvar chegava do mesmo jeito
  it("salvando, Cancelar fica desabilitado — botão ou link", () => {
    const onCancel = vi.fn();
    const first = renderBar(
      <SaveBar dirty busy saveLabel="Salvar" onSave={() => {}} cancel={{ onClick: onCancel }} />,
    );
    const button = screen.getByRole("button", { name: "Cancelar" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onCancel).not.toHaveBeenCalled();
    first.unmount();

    renderBar(<SaveBar dirty busy saveLabel="Salvar" onSave={() => {}} cancel={{ to: "/produtos" }} />);
    expect(screen.queryByRole("link", { name: "Cancelar" })).toBeNull();
    expect((screen.getByRole("button", { name: "Cancelar" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
