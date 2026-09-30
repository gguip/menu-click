/**
 * A seção ativa é a última cujo topo já passou da barra fixa (faixa da mesa +
 * abas). `tops` são os topos das seções relativos à janela, na ordem da tela.
 * No fim da página é a última: seção curta no fim nunca chega à barra.
 */
export function activeSectionIndex(tops: number[], stickyBottom: number, atPageEnd = false): number {
  if (atPageEnd && tops.length > 0) return tops.length - 1;
  let active = 0;
  tops.forEach((top, index) => {
    if (top <= stickyBottom) active = index;
  });
  return active;
}

/** Há aba escondida à esquerda / à direita? Um pixel de folga para o arredondamento. */
export function overflowEdges(scrollLeft: number, clientWidth: number, scrollWidth: number) {
  return { left: scrollLeft > 1, right: scrollLeft + clientWidth < scrollWidth - 1 };
}
