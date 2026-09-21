import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SaveBar } from "../src/ui/SaveBar.tsx";

function renderBar(ui: React.ReactElement) {
  return render(<MantineProvider env="test">{ui}</MantineProvider>);
}

describe("SaveBar", () => {
  it("só avisa de alteração quando há alteração", () => {
    const { rerender } = renderBar(
      <SaveBar dirty={false} saveLabel="Salvar" onSave={() => {}} cancel={{ onClick: () => {} }} />,
    );
    expect(screen.queryByText("Alterações não salvas")).toBeNull();
    rerender(
      <MantineProvider env="test">
        <SaveBar dirty saveLabel="Salvar" onSave={() => {}} cancel={{ onClick: () => {} }} />
      </MantineProvider>,
    );
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
});
