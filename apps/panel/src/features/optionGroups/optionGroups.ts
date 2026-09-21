import type { NewOptionBody, OptionBody, OptionGroupBody } from "../../api/optionGroups.ts";
import type { Option, OptionGroup, PriceRule, Product } from "../../api/types.ts";
import { centsToInput, parseReaisToCents } from "../../lib/money.ts";
import type { ConfirmCopy } from "../../ui/confirmCopy.ts";

/**
 * O cartão "Regra de preço", texto literal do protótipo do handoff. É texto
 * FIXO: o painel não recalcula a regra de `unitPrice()` da API.
 */
export const RULE_CARD: readonly { rule: PriceRule; name: string; help: string; example: string; when: string }[] = [
  {
    rule: "sum",
    name: "Somar",
    help: "Soma o preço de tudo que foi escolhido.",
    example: "Bacon R$ 6,00 + Ovo R$ 3,00 = R$ 9,00",
    when: "Adicionais, borda, bebida extra",
  },
  {
    rule: "highest",
    name: "Mais caro",
    help: "Cobra só a opção mais cara entre as escolhidas.",
    example: "Margherita R$ 62 + Calabresa R$ 72 = R$ 72,00",
    when: "Pizza meio a meio pelo sabor mais caro",
  },
  {
    rule: "average",
    name: "Média",
    help: "Cobra a média das opções escolhidas.",
    example: "Margherita R$ 62 + Calabresa R$ 72 = R$ 67,00",
    when: "A outra convenção de meio a meio",
  },
];

export const RULE_NAMES: Record<PriceRule, string> = { sum: "Somar", highest: "Mais caro", average: "Média" };

/** "escolhe 1 a 2", como no protótipo; "escolhe 2 a 2" leria como erro. */
export function rangeLabel(group: Pick<OptionGroup, "minOptions" | "maxOptions">): string {
  return group.minOptions === group.maxOptions
    ? `escolhe ${group.minOptions}`
    : `escolhe ${group.minOptions} a ${group.maxOptions}`;
}

/**
 * Em quantos produtos cada grupo é usado. A API não traz essa contagem, mas
 * cada produto traz `optionGroupIds` — a conta é do painel, e é PROVISÓRIA:
 * o lugar dela é um campo calculado no SQL (pendência de API).
 */
export function usageCounts(products: readonly Pick<Product, "optionGroupIds">[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const product of products) {
    for (const id of product.optionGroupIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

function produtos(count: number): string {
  return count === 1 ? "1 produto" : `${count} produtos`;
}

export function usageLabel(count: number | undefined, truncated: boolean): string {
  if (count === undefined) return "…";
  if (truncated) return count === 0 ? "uso não contado" : `usado em pelo menos ${produtos(count)}`;
  if (count === 0) return "sem produtos";
  return `usado em ${produtos(count)}`;
}

/**
 * A API tira o grupo de todo produto que o usa, na mesma transação e sem
 * avisar. Sem o número, a pessoa não sabe o que está desmontando.
 */
export function removeGroupCopy(name: string, count: number | undefined, truncated: boolean): ConfirmCopy {
  let body: string;
  if (count === undefined || truncated) {
    body = "O grupo sai de todos os produtos que o usam. Pedidos já feitos não mudam.";
  } else if (count === 0) {
    body = "Nenhum produto usa este grupo. Pedidos já feitos não mudam.";
  } else if (count === 1) {
    body = "O grupo sai do produto que o usa. Pedidos já feitos não mudam.";
  } else {
    body = `O grupo sai dos ${count} produtos que o usam. Pedidos já feitos não mudam.`;
  }
  return { title: `Remover o grupo ${name}?`, body, cta: "Remover grupo", tone: "danger" };
}

/**
 * O mínimo conta opções DISTINTAS (é o que a criação de pedido confere em
 * `services/orders.ts`), então opção esgotada não ajuda a completá-lo. A API
 * aceita esse estado — a tela informa, não trava.
 */
export function unreachable(group: OptionGroup): { required: number; available: number } | null {
  const available = group.options.filter((item) => item.available).length;
  return group.minOptions > available ? { required: group.minOptions, available } : null;
}

export function unreachableMessage({ required, available }: { required: number; available: number }): string {
  const escolhas = required === 1 ? "1 escolha" : `${required} escolhas`;
  const disponiveis =
    available === 0
      ? "nenhuma opção está disponível"
      : available === 1
        ? "só 1 opção está disponível"
        : `só ${available} opções estão disponíveis`;
  return `O cliente não consegue completar este grupo: ele exige ${escolhas} e ${disponiveis}.`;
}

/** Para a escrita otimista do interruptor "Disponível". */
export function setOptionAvailable(
  groups: readonly OptionGroup[],
  groupId: string,
  optionId: string,
  available: boolean,
): OptionGroup[] {
  return groups.map((group) =>
    group.id !== groupId
      ? group
      : { ...group, options: group.options.map((item) => (item.id === optionId ? { ...item, available } : item)) },
  );
}

const INTEGER = /^\d+$/;
const NAME_MAX = 60;

export type GroupForm = { name: string; minOptions: string; maxOptions: string; priceRule: PriceRule };

export const EMPTY_GROUP_FORM: GroupForm = { name: "", minOptions: "0", maxOptions: "1", priceRule: "sum" };

export function groupToForm(group: OptionGroup): GroupForm {
  return {
    name: group.name,
    minOptions: String(group.minOptions),
    maxOptions: String(group.maxOptions),
    priceRule: group.priceRule,
  };
}

/** Só o que a API recusa — inventar regra que o servidor aceita cria uma proibição que ninguém explica. */
export function validateGroupForm(form: GroupForm): string | null {
  const name = form.name.trim();
  if (name === "" || name.length > NAME_MAX) return "Dê um nome ao grupo, de até 60 caracteres.";
  if (!INTEGER.test(form.minOptions.trim())) return "O mínimo precisa ser um número inteiro, de 0 para cima.";
  const max = form.maxOptions.trim();
  if (!INTEGER.test(max) || Number(max) < 1) return "O máximo precisa ser um número inteiro, de 1 para cima.";
  const minimum = Number(form.minOptions.trim());
  const maximum = Number(max);
  if (minimum > maximum) return `O grupo exige ${minimum} opções mas aceita no máximo ${maximum}.`;
  return null;
}

export function groupFormToBody(form: GroupForm): OptionGroupBody {
  return {
    name: form.name.trim(),
    minOptions: Number(form.minOptions.trim()),
    maxOptions: Number(form.maxOptions.trim()),
    priceRule: form.priceRule,
  };
}

export function changedGroupPatch(form: GroupForm, group: OptionGroup): Partial<OptionGroupBody> {
  const body = groupFormToBody(form);
  const patch: Partial<OptionGroupBody> = {};
  if (body.name !== group.name) patch.name = body.name;
  if (body.minOptions !== group.minOptions) patch.minOptions = body.minOptions;
  if (body.maxOptions !== group.maxOptions) patch.maxOptions = body.maxOptions;
  if (body.priceRule !== group.priceRule) patch.priceRule = body.priceRule;
  return patch;
}

export type OptionForm = { name: string; price: string; maxQuantity: string };

export const EMPTY_OPTION_FORM: OptionForm = { name: "", price: "", maxQuantity: "1" };

export function optionToForm(option: Option): OptionForm {
  return { name: option.name, price: centsToInput(option.priceInCents), maxQuantity: String(option.maxQuantity) };
}

export function validateOptionForm(form: OptionForm): string | null {
  const name = form.name.trim();
  if (name === "" || name.length > NAME_MAX) return "Dê um nome à opção, de até 60 caracteres.";
  if (form.price.trim() !== "" && parseReaisToCents(form.price) === null) {
    return "Informe o preço em reais, como 6,00 — ou deixe em branco para R$ 0,00.";
  }
  const quantity = form.maxQuantity.trim();
  if (!INTEGER.test(quantity) || Number(quantity) < 1) {
    return "A quantidade máxima precisa ser um número inteiro, de 1 para cima.";
  }
  return null;
}

/**
 * Preço vazio é R$ 0,00: a escolha obrigatória sem custo ("ponto da carne").
 * Preço ilegível NÃO vira zero — seria entregar a opção de graça por um erro
 * de digitação. A tela valida antes (`validateOptionForm`); chegar aqui com
 * texto ilegível é erro de programação, e falha alto.
 */
export function optionFormToBody(form: OptionForm): NewOptionBody {
  const text = form.price.trim();
  const priceInCents = text === "" ? 0 : parseReaisToCents(text);
  if (priceInCents === null) {
    throw new Error(`Preço ilegível chegou a optionFormToBody: "${form.price}". Valide antes.`);
  }
  return { name: form.name.trim(), priceInCents, maxQuantity: Number(form.maxQuantity.trim()) };
}

export function changedOptionPatch(form: OptionForm, option: Option): Partial<OptionBody> {
  const body = optionFormToBody(form);
  const patch: Partial<OptionBody> = {};
  if (body.name !== option.name) patch.name = body.name;
  if (body.priceInCents !== option.priceInCents) patch.priceInCents = body.priceInCents;
  if (body.maxQuantity !== option.maxQuantity) patch.maxQuantity = body.maxQuantity;
  return patch;
}
