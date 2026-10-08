const UPLOAD_MARKER = "/image/upload/";

/**
 * A imagem do Cloudinary na largura pedida, no formato e na qualidade que o
 * navegador aguenta. URL de fora — as coladas à mão antes do upload existir, a
 * prévia local — volta intacta.
 *
 * Use poucas larguras: cada combinação nova é uma transformação cobrada da
 * cota da conta.
 */
export function imageUrl(url: string, width: number): string {
  if (!url.startsWith("https://res.cloudinary.com/")) return url;
  const at = url.indexOf(UPLOAD_MARKER);
  if (at === -1) return url;
  const cut = at + UPLOAD_MARKER.length;
  return `${url.slice(0, cut)}f_auto,q_auto,c_limit,w_${width}/${url.slice(cut)}`;
}
