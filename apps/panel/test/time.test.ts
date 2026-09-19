import { describe, expect, it } from "vitest";
import {
  elapsedMinutes,
  formatAge,
  formatClock,
  formatCountdown,
  formatElapsed,
  formatSecondsAgo,
} from "../src/lib/time.ts";

const NOW = Date.parse("2026-09-19T23:00:00.000Z");

describe("time", () => {
  it("diz há quanto tempo, na unidade que se lê de relance", () => {
    expect(formatElapsed("2026-09-19T22:59:30.000Z", NOW)).toBe("agora");
    expect(formatElapsed("2026-09-19T22:58:00.000Z", NOW)).toBe("há 2 min");
    expect(formatElapsed("2026-09-19T21:00:00.000Z", NOW)).toBe("há 2 h");
    expect(formatElapsed("2026-09-17T23:00:00.000Z", NOW)).toBe("há 2 d");
  });

  it("conta os minutos inteiros", () => {
    expect(elapsedMinutes("2026-09-19T22:30:00.000Z", NOW)).toBe(30);
  });

  it("mostra a hora no fuso da loja", () => {
    expect(formatClock("2026-09-19T23:10:00.000Z", "America/Sao_Paulo")).toBe("20:10");
  });

  it("formata a contagem regressiva do reenvio", () => {
    expect(formatCountdown(38)).toBe("0:38");
    expect(formatCountdown(75)).toBe("1:15");
  });

  it("diz a idade da lista em palavras", () => {
    expect(formatAge(1)).toBe("1 segundo");
    expect(formatAge(40)).toBe("40 segundos");
    expect(formatAge(60)).toBe("1 minuto");
    expect(formatAge(180)).toBe("3 minutos");
  });

  it("monta o 'há N s' da barra de filtros", () => {
    expect(formatSecondsAgo(NOW - 6_000, NOW)).toBe("há 6 s");
  });
});
