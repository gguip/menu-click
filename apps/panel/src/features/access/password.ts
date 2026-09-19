const encoder = new TextEncoder();

/**
 * Mesmas regras da API: mínimo de 8 caracteres e teto de 72 BYTES — o bcrypt
 * ignora tudo depois do byte 72, em silêncio (S20). A API recusa com 400; a
 * tela avisa antes, com texto que a pessoa entende.
 */
export function checkPassword(password: string): string | null {
  if (password.length < 8) return "A senha precisa de pelo menos 8 caracteres.";
  if (encoder.encode(password).length > 72) {
    return "A senha passou do limite: use até 72 bytes (letras acentuadas contam em dobro).";
  }
  return null;
}
