import { describe, expect, it } from "vitest";
import {
  addRange,
  crossesMidnight,
  daySummary,
  fromApi,
  removeRange,
  setRangeTime,
  toApi,
  validate,
  WEEK,
} from "../src/features/settings/openingHours.ts";

const API = [
  { id: "1", weekday: 1, opensAt: "11:30", closesAt: "15:00" },
  { id: "2", weekday: 1, opensAt: "18:00", closesAt: "23:30" },
  { id: "3", weekday: 6, opensAt: "18:00", closesAt: "02:00" },
];

describe("grade de horário", () => {
  it("mostra a semana da segunda ao domingo, com a numeração da API", () => {
    expect(WEEK.map((day) => [day.weekday, day.label])).toEqual([
      [1, "Segunda"],
      [2, "Terça"],
      [3, "Quarta"],
      [4, "Quinta"],
      [5, "Sexta"],
      [6, "Sábado"],
      [0, "Domingo"],
    ]);
  });

  it("agrupa as faixas por dia e devolve todos os sete", () => {
    const days = fromApi(API);
    expect(days).toHaveLength(7);
    expect(days[0].ranges).toEqual([
      { opensAt: "11:30", closesAt: "15:00" },
      { opensAt: "18:00", closesAt: "23:30" },
    ]);
    expect(days[6].ranges).toEqual([]);
  });

  it("volta para a API sem os dias fechados", () => {
    expect(toApi(fromApi(API))).toEqual([
      { weekday: 1, opensAt: "11:30", closesAt: "15:00" },
      { weekday: 1, opensAt: "18:00", closesAt: "23:30" },
      { weekday: 6, opensAt: "18:00", closesAt: "02:00" },
    ]);
  });

  it("acrescenta, muda e remove faixa sem mutar", () => {
    const days = fromApi([]);
    const withOne = addRange(days, 3);
    expect(withOne[2].ranges).toEqual([{ opensAt: "", closesAt: "" }]);
    expect(days[2].ranges).toEqual([]);
    const filled = setRangeTime(setRangeTime(withOne, 3, 0, "opensAt", "18:00"), 3, 0, "closesAt", "23:00");
    expect(filled[2].ranges).toEqual([{ opensAt: "18:00", closesAt: "23:00" }]);
    expect(removeRange(filled, 3, 0)[2].ranges).toEqual([]);
  });

  it("reconhece a faixa que vira a madrugada", () => {
    expect(crossesMidnight({ opensAt: "18:00", closesAt: "02:00" })).toBe(true);
    expect(crossesMidnight({ opensAt: "11:30", closesAt: "15:00" })).toBe(false);
    expect(crossesMidnight({ opensAt: "18:00", closesAt: "" })).toBe(false);
  });

  it("resume o dia", () => {
    const days = fromApi(API);
    expect(daySummary(days[0])).toBe("2 faixas");
    expect(daySummary(days[5])).toBe("Aberto");
    expect(daySummary(days[6])).toBe("Fechado");
  });

  it("valida só o que a API recusa, nomeando o dia", () => {
    expect(validate(fromApi(API))).toBeNull();
    // sobreposição NÃO é erro para a API: a tela não inventa a regra
    const overlapping = addRange(fromApi(API), 1);
    const filled = setRangeTime(
      setRangeTime(overlapping, 1, 2, "opensAt", "12:00"),
      1,
      2,
      "closesAt",
      "14:00",
    );
    expect(validate(filled)).toBeNull();

    const incomplete = addRange(fromApi([]), 2);
    expect(validate(incomplete)).toBe("Preencha as duas horas da faixa de terça.");

    const equal = setRangeTime(
      setRangeTime(addRange(fromApi([]), 5), 5, 0, "opensAt", "19:00"),
      5,
      0,
      "closesAt",
      "19:00",
    );
    expect(validate(equal)).toBe("A faixa de sexta começa e termina no mesmo horário.");
  });
});
