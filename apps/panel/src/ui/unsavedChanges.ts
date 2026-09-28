/**
 * Marca no `state` da navegação que ela sai de uma tela suja DE PROPÓSITO: o
 * salvar que navega em seguida, o "Cancelar", a sessão expirada, o "Sair" e a
 * loja removida. O aviso da `SaveBar` deixa passar sem perguntar.
 */
export const LEAVE_WITHOUT_ASKING = { leaveWithoutAsking: true } as const;

export function leavesWithoutAsking(state: unknown): boolean {
  return typeof state === "object" && state !== null && "leaveWithoutAsking" in state;
}
