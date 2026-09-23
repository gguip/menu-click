import type { Table } from "../../api/types.ts";
import type { ConfirmCopy } from "../../ui/confirmCopy.ts";

export function toggleSelection(selected: readonly string[], id: string): string[] {
  return selected.includes(id) ? selected.filter((each) => each !== id) : [...selected, id];
}

/**
 * A seleção é por id e descarta o que sumiu da lista: com dois aparelhos
 * abertos, a mesa removida no outro não pode entrar na contagem do botão nem
 * na folha de impressão.
 */
export function visibleSelection(selected: readonly string[], tables: readonly Table[]): string[] {
  return selected.filter((id) => tables.some((table) => table.id === id));
}

export function allSelected(selected: readonly string[], tables: readonly Table[]): boolean {
  if (tables.length === 0) return false;
  return visibleSelection(selected, tables).length === tables.length;
}

export function selectAllLabel(everythingSelected: boolean): string {
  return everythingSelected ? "Limpar seleção" : "Selecionar todas";
}

export function printButtonLabel(count: number): string {
  if (count === 0) return "Selecione para imprimir";
  return count === 1 ? "Imprimir 1 adesivo" : `Imprimir ${count} adesivos`;
}

export function labelError(label: string): string | null {
  return label.trim() === "" ? "Dê um rótulo à mesa." : null;
}

export function rotateConfirm(label: string): ConfirmCopy {
  return {
    title: `Gerar um código novo para a "${label}"?`,
    body: "O adesivo que está na mesa para de funcionar imediatamente. Quem apontar a câmera para o QR antigo não abre o cardápio.",
    warn: "Só faça isso se você vai reimprimir e trocar o adesivo agora.",
    cta: "Gerar código novo",
    tone: "danger",
  };
}

export function removeConfirm(label: string): ConfirmCopy {
  return {
    title: `Remover a "${label}"?`,
    body: "O adesivo dela para de funcionar. Os pedidos que ela atendeu continuam no histórico, com o rótulo que já tinham.",
    cta: "Remover mesa",
    tone: "danger",
  };
}
