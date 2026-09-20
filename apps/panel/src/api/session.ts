import type { LoginResponse } from "./types.ts";

// Provisório (spec, ponto 5 das pendências): localStorage é exposto a XSS.
// A alternativa é cookie httpOnly num BFF, e a decisão foi adiada.
const STORAGE_KEY = "menuclick.session";

export type Session = LoginResponse;

export function readSession(): Session | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Session>;
    if (typeof parsed.token !== "string" || typeof parsed.expiresAt !== "string") {
      clearSession();
      return null;
    }
    if (Date.parse(parsed.expiresAt) <= Date.now()) {
      clearSession();
      return null;
    }
    return { token: parsed.token, expiresAt: parsed.expiresAt };
  } catch {
    clearSession();
    return null;
  }
}

export function saveSession(session: Session): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // storage indisponível (janela privada, cota estourada, bloqueio de
    // navegador): sem isso, o login inteiro quebrava por causa de um
    // `localStorage` que nem é essencial ao gesto de "entrar" (FIX 8).
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage indisponível: não há o que limpar
  }
}
