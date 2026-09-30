// apps/panel/test/times.test.ts
import { describe, expect, it } from "vitest";
import { timesFromRestaurant, timesPatch, validateTimes } from "../src/features/settings/times.ts";

describe("tempos estimados", () => {
  it("lê do restaurante; ausente vira campo vazio", () => {
    expect(timesFromRestaurant({ prepTimeMinutes: 25 })).toEqual({ prep: "25", min: "", max: "" });
    expect(timesFromRestaurant({ deliveryTimeMinMinutes: 40, deliveryTimeMaxMinutes: 55 })).toEqual({ prep: "", min: "40", max: "55" });
  });

  it("valida 1–240, mínimo até o máximo, e a faixa em par", () => {
    expect(validateTimes({ prep: "25", min: "40", max: "55" })).toBeNull();
    expect(validateTimes({ prep: "", min: "", max: "" })).toBeNull();
    expect(validateTimes({ prep: "0", min: "", max: "" })).toBe("Use minutos entre 1 e 240.");
    expect(validateTimes({ prep: "abc", min: "", max: "" })).toBe("Use minutos entre 1 e 240.");
    expect(validateTimes({ prep: "", min: "60", max: "40" })).toBe("O tempo mínimo da entrega não pode passar do máximo.");
    expect(validateTimes({ prep: "", min: "40", max: "" })).toBe("Preencha os dois tempos da entrega, ou deixe os dois vazios.");
  });

  it("manda só o que mudou; vazio vai como null", () => {
    const initial = { prep: "25", min: "40", max: "55" };
    expect(timesPatch({ prep: "30", min: "40", max: "55" }, initial)).toEqual({ prepTimeMinutes: 30 });
    expect(timesPatch({ prep: "", min: "40", max: "55" }, initial)).toEqual({ prepTimeMinutes: null });
    // a faixa vai sempre em par: a API exige os dois juntos
    expect(timesPatch({ prep: "25", min: "45", max: "55" }, initial)).toEqual({ deliveryTimeMinMinutes: 45, deliveryTimeMaxMinutes: 55 });
    expect(timesPatch({ prep: "25", min: "", max: "" }, initial)).toEqual({ deliveryTimeMinMinutes: null, deliveryTimeMaxMinutes: null });
    expect(timesPatch(initial, initial)).toEqual({});
  });
});
