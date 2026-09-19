/**
 * Código curto do pedido para falar no balcão. A API só tem UUID, então o
 * código sai dos 4 primeiros hex dele: estável, mas NÃO sequencial. Quando a
 * API ganhar número por loja (pendência da spec), troca-se só esta função.
 */
export function orderCode(id: string): string {
  return `#${id.replace(/-/g, "").slice(0, 4).toUpperCase()}`;
}
