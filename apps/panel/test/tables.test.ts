import { describe, expect, it } from "vitest";
import type { Table } from "../src/api/types.ts";
import {
  allSelected,
  labelError,
  printButtonLabel,
  removeConfirm,
  rotateConfirm,
  selectAllLabel,
  toggleSelection,
  visibleSelection,
} from "../src/features/tables/tables.ts";

function makeTable(id: string, label: string): Table {
  return {
    id,
    restaurantId: "r-1",
    label,
    hash: `hash-${id}`,
    qrUrl: `http://localhost:5173/loja?mesa=hash-${id}`,
  };
}

const tables = [makeTable("t-1", "Mesa 1"), makeTable("t-2", "Mesa 2")];

describe("regras das mesas", () => {
  it("o rótulo do botão de impressão conta o que está selecionado", () => {
    expect(printButtonLabel(0)).toBe("Selecione para imprimir");
    expect(printButtonLabel(1)).toBe("Imprimir 1 adesivo");
    expect(printButtonLabel(4)).toBe("Imprimir 4 adesivos");
  });

  it("'Selecionar todas' vira 'Limpar seleção' quando tudo está marcado", () => {
    expect(selectAllLabel(false)).toBe("Selecionar todas");
    expect(selectAllLabel(true)).toBe("Limpar seleção");
  });

  it("marcar e desmarcar é a mesma ação", () => {
    expect(toggleSelection([], "t-1")).toEqual(["t-1"]);
    expect(toggleSelection(["t-1", "t-2"], "t-1")).toEqual(["t-2"]);
  });

  it("a seleção descarta a mesa que sumiu da lista", () => {
    // outro aparelho removeu a t-2: ela não pode entrar na contagem nem na folha
    expect(visibleSelection(["t-1", "t-2"], [tables[0]])).toEqual(["t-1"]);
  });

  it("tudo selecionado é falso quando não há mesa nenhuma", () => {
    expect(allSelected([], [])).toBe(false);
    expect(allSelected(["t-1"], tables)).toBe(false);
    expect(allSelected(["t-1", "t-2"], tables)).toBe(true);
    // id fantasma não conta como "tudo selecionado"
    expect(allSelected(["t-1", "t-9"], tables)).toBe(false);
  });

  it("rótulo vazio ou só espaço é barrado antes da chamada", () => {
    expect(labelError("")).toBe("Dê um rótulo à mesa.");
    expect(labelError("   ")).toBe("Dê um rótulo à mesa.");
    expect(labelError("Mesa 7")).toBeNull();
  });

  it("a confirmação de código novo diz a consequência e o aviso", () => {
    const copy = rotateConfirm("Mesa 7");
    expect(copy.title).toBe('Gerar um código novo para a "Mesa 7"?');
    expect(copy.body).toBe(
      "O adesivo que está na mesa para de funcionar imediatamente. Quem apontar a câmera para o QR antigo não abre o cardápio.",
    );
    expect(copy.warn).toBe("Só faça isso se você vai reimprimir e trocar o adesivo agora.");
    expect(copy.cta).toBe("Gerar código novo");
    expect(copy.tone).toBe("danger");
  });

  it("a confirmação de remover promete o histórico intacto", () => {
    const copy = removeConfirm("Varanda 1");
    expect(copy.title).toBe('Remover a "Varanda 1"?');
    expect(copy.body).toBe(
      "O adesivo dela para de funcionar. Os pedidos que ela atendeu continuam no histórico, com o rótulo que já tinham.",
    );
    expect(copy.cta).toBe("Remover mesa");
  });
});
