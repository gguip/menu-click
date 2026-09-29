/**
 * A mesa do QR, do ponto de vista de quem escaneou. Ter `?mesa=` na URL já é
 * estar no salão — resolver o rótulo só diz QUAL mesa. Por isso nenhum dos
 * estados abaixo tira a pessoa do salão: a mesa que não resolveu continua
 * pedindo, e quem decide o que vai no pedido é o servidor.
 */
export type TableState =
  | { kind: "none" }
  | { kind: "resolving"; hash: string }
  | { kind: "found"; hash: string; label: string }
  /** 404: adesivo velho, mesa removida ou código girado. Pede sem a mesa. */
  | { kind: "not-found"; hash: string }
  /** Rede, 5xx, 429 (a API acordando): não dá para saber. Pede com o hash. */
  | { kind: "unreachable"; hash: string };

export type TableLookup = { kind: "found"; label: string } | { kind: "not-found" } | { kind: "unreachable" };

export function tableHashFromSearch(search: string): string | null {
  const hash = new URLSearchParams(search).get("mesa");
  return hash && hash.trim() !== "" ? hash : null;
}

/** O hash do carrinho e do pedido: o da URL, qualquer que seja o estado. */
export function tableHashOf(table: TableState): string | null {
  return table.kind === "none" ? null : table.hash;
}

/** O que vai no POST: o hash, menos quando o servidor já disse que não existe. */
export function orderTableHash(table: TableState): string | null {
  return table.kind === "none" || table.kind === "not-found" ? null : table.hash;
}

export function tableLabelOf(table: TableState): string | null {
  return table.kind === "found" ? table.label : null;
}
