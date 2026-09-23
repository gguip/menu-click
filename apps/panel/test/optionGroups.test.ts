import { describe, expect, it } from "vitest";
import {
  changedGroupPatch,
  changedOptionPatch,
  EMPTY_GROUP_FORM,
  EMPTY_OPTION_FORM,
  groupFormToBody,
  groupToForm,
  optionFormToBody,
  optionToForm,
  rangeLabel,
  removeGroupCopy,
  RULE_CARD,
  setOptionAvailable,
  unreachable,
  unreachableMessage,
  usageCounts,
  usageLabel,
  validateGroupForm,
  validateOptionForm,
} from "../src/features/optionGroups/optionGroups.ts";
import { makeOptionGroup } from "./fixtures.ts";

const option = (id: string, available = true, priceInCents = 0) => ({
  id,
  name: id,
  priceInCents,
  maxQuantity: 1,
  available,
  position: 0,
});

describe("rótulos", () => {
  it("intervalo no padrão do protótipo, e 'escolhe n' quando mínimo = máximo", () => {
    expect(rangeLabel({ minOptions: 1, maxOptions: 2 })).toBe("escolhe 1 a 2");
    expect(rangeLabel({ minOptions: 0, maxOptions: 1 })).toBe("escolhe 0 a 1");
    expect(rangeLabel({ minOptions: 2, maxOptions: 2 })).toBe("escolhe 2");
  });

  it("o cartão de regras é literal do protótipo", () => {
    expect(RULE_CARD.map((rule) => rule.example)).toEqual([
      "Bacon R$ 6,00 + Ovo R$ 3,00 = R$ 9,00",
      "Margherita R$ 62 + Calabresa R$ 72 = R$ 72,00",
      "Margherita R$ 62 + Calabresa R$ 72 = R$ 67,00",
    ]);
  });
});

describe("uso em produtos", () => {
  it("conta os vínculos pelos optionGroupIds", () => {
    const counts = usageCounts([
      { optionGroupIds: ["a", "b"] },
      { optionGroupIds: ["a"] },
      { optionGroupIds: [] },
    ]);
    expect(counts.get("a")).toBe(2);
    expect(counts.get("b")).toBe(1);
    expect(counts.get("c")).toBeUndefined();
  });

  it("o rótulo diz 'pelo menos' quando a contagem parou antes do fim", () => {
    expect(usageLabel(undefined, false)).toBe("…");
    expect(usageLabel(0, false)).toBe("sem produtos");
    expect(usageLabel(1, false)).toBe("usado em 1 produto");
    expect(usageLabel(3, false)).toBe("usado em 3 produtos");
    expect(usageLabel(3, true)).toBe("usado em pelo menos 3 produtos");
    expect(usageLabel(0, true)).toBe("uso não contado");
  });

  it("a confirmação de remover diz quantos produtos perdem o grupo", () => {
    expect(removeGroupCopy("Sabores", 3, false)).toEqual({
      title: "Remover o grupo Sabores?",
      body: "O grupo sai dos 3 produtos que o usam. Pedidos já feitos não mudam.",
      cta: "Remover grupo",
      tone: "danger",
    });
    expect(removeGroupCopy("Sabores", 1, false).body).toBe(
      "O grupo sai do produto que o usa. Pedidos já feitos não mudam.",
    );
    expect(removeGroupCopy("Sabores", 0, false).body).toBe(
      "Nenhum produto usa este grupo. Pedidos já feitos não mudam.",
    );
    expect(removeGroupCopy("Sabores", 3, true).body).toBe(
      "O grupo sai de todos os produtos que o usam. Pedidos já feitos não mudam.",
    );
  });
});

describe("grupo que não se completa", () => {
  it("conta só as opções disponíveis", () => {
    const group = makeOptionGroup({ minOptions: 2, options: [option("a"), option("b", false)] });
    expect(unreachable(group)).toEqual({ required: 2, available: 1 });
    expect(unreachable(makeOptionGroup({ minOptions: 1, options: [option("a")] }))).toBeNull();
    expect(unreachable(makeOptionGroup({ minOptions: 0, options: [] }))).toBeNull();
  });

  it("a mensagem acerta singular e plural", () => {
    expect(unreachableMessage({ required: 2, available: 1 })).toBe(
      "O cliente não consegue completar este grupo: ele exige 2 escolhas e só 1 opção está disponível.",
    );
    expect(unreachableMessage({ required: 1, available: 0 })).toBe(
      "O cliente não consegue completar este grupo: ele exige 1 escolha e nenhuma opção está disponível.",
    );
    expect(unreachableMessage({ required: 3, available: 2 })).toBe(
      "O cliente não consegue completar este grupo: ele exige 3 escolhas e só 2 opções estão disponíveis.",
    );
  });
});

describe("setOptionAvailable", () => {
  it("troca só a opção pedida, sem mexer no original", () => {
    const groups = [makeOptionGroup({ id: "g", options: [option("a"), option("b")] })];
    const next = setOptionAvailable(groups, "g", "b", false);
    expect(next[0].options.map((item) => item.available)).toEqual([true, false]);
    expect(groups[0].options[1].available).toBe(true);
  });
});

describe("formulário do grupo", () => {
  it("valida só o que a API recusa", () => {
    const valid = { name: "Borda", minOptions: "0", maxOptions: "1", priceRule: "sum" as const };
    expect(validateGroupForm(valid)).toBeNull();
    expect(validateGroupForm({ ...valid, name: "  " })).toBe("Dê um nome ao grupo, de até 60 caracteres.");
    expect(validateGroupForm({ ...valid, name: "x".repeat(61) })).toBe("Dê um nome ao grupo, de até 60 caracteres.");
    expect(validateGroupForm({ ...valid, minOptions: "-1" })).toBe("O mínimo precisa ser um número inteiro, de 0 para cima.");
    expect(validateGroupForm({ ...valid, maxOptions: "0" })).toBe("O máximo precisa ser um número inteiro, de 1 para cima.");
    expect(validateGroupForm({ ...valid, minOptions: "3", maxOptions: "2" })).toBe(
      "O grupo exige 3 opções mas aceita no máximo 2.",
    );
  });

  it("vira corpo de criação e patch só do que mudou", () => {
    expect(EMPTY_GROUP_FORM).toEqual({ name: "", minOptions: "0", maxOptions: "1", priceRule: "sum" });
    expect(groupFormToBody({ name: " Borda ", minOptions: "0", maxOptions: "1", priceRule: "sum" })).toEqual({
      name: "Borda",
      minOptions: 0,
      maxOptions: 1,
      priceRule: "sum",
    });
    const group = makeOptionGroup({ name: "Sabores", minOptions: 1, maxOptions: 2, priceRule: "highest" });
    expect(changedGroupPatch(groupToForm(group), group)).toEqual({});
    expect(changedGroupPatch({ ...groupToForm(group), priceRule: "average", maxOptions: "3" }, group)).toEqual({
      maxOptions: 3,
      priceRule: "average",
    });
  });
});

describe("formulário da opção", () => {
  it("preço vazio é R$ 0,00 (escolha obrigatória sem custo)", () => {
    expect(EMPTY_OPTION_FORM).toEqual({ name: "", price: "", maxQuantity: "1" });
    expect(optionFormToBody({ name: " Ao ponto ", price: "", maxQuantity: "1" })).toEqual({
      name: "Ao ponto",
      priceInCents: 0,
      maxQuantity: 1,
    });
  });

  it("valida nome, preço e quantidade", () => {
    const valid = { name: "Bacon", price: "6,00", maxQuantity: "2" };
    expect(validateOptionForm(valid)).toBeNull();
    expect(validateOptionForm({ ...valid, name: "" })).toBe("Dê um nome à opção, de até 60 caracteres.");
    expect(validateOptionForm({ ...valid, price: "seis" })).toBe(
      "Informe o preço em reais, como 6,00 — ou deixe em branco para R$ 0,00.",
    );
    expect(validateOptionForm({ ...valid, maxQuantity: "0" })).toBe(
      "A quantidade máxima precisa ser um número inteiro, de 1 para cima.",
    );
  });

  it("patch só do que mudou", () => {
    const opt = { ...option("opt-1", true, 7200), name: "Calabresa" };
    expect(changedOptionPatch(optionToForm(opt), opt)).toEqual({});
    expect(changedOptionPatch({ ...optionToForm(opt), price: "75,00" }, opt)).toEqual({ priceInCents: 7500 });
  });

  it("preço ilegível não vira zero: falha alto", () => {
    expect(() => optionFormToBody({ name: "Bacon", price: "seis", maxQuantity: "1" })).toThrow();
  });
});
