import { describe, expect, it } from "vitest";
import { clearSession, readSession, saveSession } from "../src/api/session.ts";

describe("session", () => {
  it("guarda e lê a sessão", () => {
    saveSession({ token: "abc", expiresAt: "2099-01-01T00:00:00.000Z" });
    expect(readSession()).toEqual({ token: "abc", expiresAt: "2099-01-01T00:00:00.000Z" });
  });

  it("sessão vencida some sozinha", () => {
    saveSession({ token: "abc", expiresAt: "2000-01-01T00:00:00.000Z" });
    expect(readSession()).toBeNull();
    expect(localStorage.getItem("menuclick.session")).toBeNull();
  });

  it("lixo no storage vira sessão nenhuma", () => {
    localStorage.setItem("menuclick.session", "{não é json");
    expect(readSession()).toBeNull();
  });

  it("clearSession apaga", () => {
    saveSession({ token: "abc", expiresAt: "2099-01-01T00:00:00.000Z" });
    clearSession();
    expect(readSession()).toBeNull();
  });
});
