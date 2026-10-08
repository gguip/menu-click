import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { type ImageChange, KEEP } from "../src/lib/upload.ts";
import { ImageField } from "../src/ui/ImageField.tsx";

const SAVED = "https://res.cloudinary.com/nuvem/image/upload/v1/menuclick/r/logo.jpg";
const seen: ImageChange[] = [];

function Harness({ saved }: { saved?: string }) {
  const [change, setChange] = useState<ImageChange>(KEEP);
  return (
    <MantineProvider env="test">
      <ImageField
        label="Logo"
        saved={saved}
        change={change}
        onChange={(next) => {
          seen.push(next);
          setChange(next);
        }}
      />
    </MantineProvider>
  );
}

function pick(file: File) {
  fireEvent.change(screen.getByLabelText("Logo"), { target: { files: [file] } });
}

const jpg = () => new File(["x"], "logo.jpg", { type: "image/jpeg" });

describe("ImageField", () => {
  it("sem imagem: mostra 'Sem imagem' e só o botão de escolher", () => {
    render(<Harness />);
    expect(screen.getByText("Sem imagem")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Escolher Logo" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remover Logo" })).toBeNull();
  });

  it("com imagem salva: mostra a miniatura transformada, Trocar e Remover", () => {
    const { container } = render(<Harness saved={SAVED} />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "https://res.cloudinary.com/nuvem/image/upload/f_auto,q_auto,c_limit,w_400/v1/menuclick/r/logo.jpg",
    );
    expect(screen.getByRole("button", { name: "Trocar Logo" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remover Logo" })).toBeTruthy();
  });

  it("escolher mostra a prévia local e avisa a troca, sem enviar nada", () => {
    seen.length = 0;
    const { container } = render(<Harness />);
    const file = jpg();
    pick(file);
    expect(seen).toEqual([{ kind: "replace", file, previewUrl: "blob:previa" }]);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:previa");
  });

  it("arquivo que não serve mostra o motivo e não avisa troca", () => {
    seen.length = 0;
    render(<Harness />);
    pick(new File(["x"], "foto.heic", { type: "image/heic" }));
    expect(screen.getByText("Use uma imagem JPG, PNG ou WebP.")).toBeTruthy();
    expect(seen).toEqual([]);
  });

  it("escolher um arquivo bom depois de um ruim apaga o aviso", () => {
    render(<Harness />);
    pick(new File(["x"], "foto.heic", { type: "image/heic" }));
    pick(jpg());
    expect(screen.queryByText("Use uma imagem JPG, PNG ou WebP.")).toBeNull();
  });

  it("Remover de imagem salva avisa a remoção; de imagem só escolhida, volta ao que era", () => {
    seen.length = 0;
    const salva = render(<Harness saved={SAVED} />);
    fireEvent.click(screen.getByRole("button", { name: "Remover Logo" }));
    expect(seen).toEqual([{ kind: "remove" }]);
    expect(screen.getByText("Sem imagem")).toBeTruthy();
    salva.unmount();

    seen.length = 0;
    render(<Harness />);
    pick(jpg());
    fireEvent.click(screen.getByRole("button", { name: "Remover Logo" }));
    expect(seen[1]).toEqual({ kind: "keep" });
    expect(screen.getByText("Sem imagem")).toBeTruthy();
  });

  // o `input` de arquivo não dispara `change` quando o valor é o mesmo: sem
  // limpar o valor, escolher de novo o arquivo recém-removido não faria nada
  it("depois de escolher, o input fica vazio para aceitar o mesmo arquivo de novo", () => {
    render(<Harness />);
    pick(jpg());
    expect((screen.getByLabelText("Logo") as HTMLInputElement).value).toBe("");
  });
});
