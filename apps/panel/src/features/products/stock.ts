export function stockTone(stock: number): "danger" | "warn" | "normal" {
  if (stock === 0) return "danger";
  if (stock <= 5) return "warn";
  return "normal";
}

export function stockText(stock: number): string {
  return stock === 0 ? "esgotado" : String(stock);
}
