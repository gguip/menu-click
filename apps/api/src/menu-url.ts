/**
 * A base da URL pública do cardápio — o endereço que o cliente abre.
 *
 * Mora num módulo próprio pelo mesmo motivo de `email.ts`: é configuração de
 * ambiente com uma guarda de subida, e nem o domínio nem os repositórios têm
 * o que fazer com `process.env`.
 */

/**
 * 🚨 Sem `MENU_BASE_URL` o processo NÃO SOBE.
 *
 * É mais duro que o precedente das URLs de e-mail, que só derrubam o boot com
 * `EMAIL_DRIVER=smtp`, e a diferença é o custo do erro. Um link de e-mail
 * errado gera um chamado de suporte e um reenvio. Uma URL de QR errada já foi
 * **impressa, plastificada e colada em quarenta mesas** antes de alguém
 * escanear a primeira — e consertar é trabalho físico, não um deploy. O
 * `email.ts` já argumenta que "um e-mail que chega com link errado é tão
 * inútil quanto um que não chega"; aqui o inútil vem em papel.
 *
 * A URL precisa ser PARSEÁVEL, não só existir — mesma checagem que a
 * `SMTP_URL` recebe, e pelo mesmo motivo: uma base malformada só apareceria
 * como QR que não abre, muito depois de ter sido colado.
 */
export function assertMenuBaseUrl(): void {
  const base = process.env.MENU_BASE_URL;
  if (base === undefined || base === "") {
    throw new Error(
      "MENU_BASE_URL é obrigatória: é a base da URL que vai dentro do QR code das mesas",
    );
  }
  try {
    new URL(base);
  } catch {
    throw new Error("MENU_BASE_URL não é uma URL válida");
  }
}

/**
 * A URL que vai dentro do QR code de uma mesa.
 *
 * O servidor a monta inteira, em vez de devolver só o hash, porque foi o que
 * o front pediu: com ela pronta, desenhar o QR é `<QRCode value={qrUrl} />` e
 * mais nada — nenhuma das bibliotecas do ecossistema precisa de outra coisa
 * além da string.
 *
 * O slug entra no caminho e o hash na querystring, de propósito: o cardápio
 * público continua sendo `GET /menu/:slug`, com UMA implementação. Uma URL
 * auto-contida (`/m/<hash>`) economizaria treze caracteres e custaria um
 * segundo cardápio público para manter em sincronia com o primeiro — e este
 * repositório já tem cicatriz de duas listas que deviam concordar e
 * divergiram.
 */
export function tableQrUrl(slug: string, hash: string): string {
  const base = process.env.MENU_BASE_URL as string;
  return `${base.replace(/\/+$/, "")}/${slug}?mesa=${hash}`;
}
