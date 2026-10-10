import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { theme } from "../src/theme/theme.ts";
import { TimeField } from "../src/ui/TimeField.tsx";

function Harness({ onChange }: { onChange: (value: string) => void }) {
  const [value, setValue] = useState("18:30");
  return (
    <MantineProvider theme={theme} env="test">
      <TimeField
        label="Abre"
        value={value}
        onChange={(next) => {
          setValue(next);
          onChange(next);
        }}
      />
      <button type="button" onClick={() => setValue("09:15")}>
        Descartar
      </button>
    </MantineProvider>
  );
}

const hour = () => screen.getByLabelText("Abre, hora") as HTMLInputElement;
const minute = () => screen.getByLabelText("Abre, minuto") as HTMLInputElement;

describe("TimeField", () => {
  it("mostra a hora recebida e devolve HH:mm, sem os segundos", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    expect(`${hour().value}:${minute().value}`).toBe("18:30");
    fireEvent.change(hour(), { target: { value: "20" } });
    expect(onChange).toHaveBeenLastCalledWith("20:30");
  });

  it("apagar os minutos avisa hora pela metade e NÃO apaga a hora", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.keyDown(minute(), { key: "Backspace" });
    expect(onChange).toHaveBeenLastCalledWith("");
    expect(hour().value).toBe("18");
    expect(minute().value).toBe("");
  });

  it("valor trocado por fora aparece no campo", () => {
    render(<Harness onChange={() => {}} />);
    fireEvent.keyDown(minute(), { key: "Backspace" });
    fireEvent.click(screen.getByRole("button", { name: "Descartar" }));
    expect(`${hour().value}:${minute().value}`).toBe("09:15");
  });
});
