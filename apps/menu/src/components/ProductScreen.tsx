"use client";

import { useState } from "react";
import { type CartLine, lineKey, normalizeNote } from "@/lib/cart.ts";
import { formatCents } from "@/lib/money.ts";
import {
  groupBadge,
  groupHint,
  itemUnitPrice,
  lockReason,
  missingGroup,
  optionPriceLabel,
  productGroups,
  type Selection,
  toggleOption,
} from "@/lib/selection.ts";
import type { MenuOptionGroup, MenuProduct } from "@/lib/types.ts";
import { FIELD_BOX, FIELD_FOCUS, FIELD_TEXT } from "./field.ts";
import { BackIcon, CheckIcon, MinusIcon, PlusIcon } from "./icons.tsx";

export const NOTE_MAX_LENGTH = 140;

/**
 * Onde o pedido é montado de verdade. O preço ao vivo sai do MESMO código que
 * a API usa para cobrar (`@menuclick/pricing`), e o botão travado diz o que
 * falta — nunca só apagado.
 */
export function ProductScreen({
  product,
  groups: allGroups,
  canOrder,
  onBack,
  onAdd,
}: {
  product: MenuProduct;
  groups: MenuOptionGroup[];
  /** Fechada, pausada ou sem mesa (parte 1): dá para ver, não para adicionar. */
  canOrder: boolean;
  onBack: () => void;
  onAdd: (line: CartLine) => void;
}) {
  const groups = productGroups(product, allGroups);
  const [selection, setSelection] = useState<Selection>({});
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState("");

  const unit = itemUnitPrice(product, allGroups, selection);
  const missing = missingGroup(groups, selection);

  const add = () => {
    const chosen = groups.flatMap((group) =>
      (selection[group.id] ?? []).map((id) => ({
        optionId: id,
        name: group.options.find((option) => option.id === id)?.name ?? "",
      })),
    );
    onAdd({
      key: lineKey(product.id, selection, note),
      productId: product.id,
      name: product.name,
      unitPriceInCents: unit,
      quantity,
      options: chosen,
      note: normalizeNote(note),
    });
  };

  return (
    <main className="pb-44">
      <div className="relative flex h-[188px] items-center justify-center bg-paper-3">
        {product.photoUrl ? (
          <img src={product.photoUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="text-[11px] uppercase tracking-[0.14em] text-ink-3">foto do produto</span>
        )}
        <button
          type="button"
          aria-label="Voltar"
          onClick={onBack}
          className="absolute left-3.5 top-3.5 flex size-11 items-center justify-center rounded-full bg-paper text-ink shadow-[0_2px_8px_rgba(11,13,18,0.18)]"
        >
          <BackIcon size={20} />
        </button>
      </div>

      <div className="px-4 pt-[18px]">
        <h1 className="text-[21px] font-semibold leading-tight tracking-[-0.02em]">{product.name}</h1>
        {product.description && <p className="mt-1.5 text-sm leading-[1.45] text-ink-2">{product.description}</p>}
        <p className="mt-2.5 text-[17px] font-semibold tabular-nums">{formatCents(product.priceInCents)}</p>
      </div>

      {groups.map((group) => (
        <fieldset key={group.id} className="mt-[22px] border-t border-paper-3">
          <legend className="sr-only">{group.name}</legend>
          <div className="flex items-start gap-2.5 px-4 pb-2.5 pt-4" aria-hidden="true">
            <div className="min-w-0">
              <p className="text-base font-semibold tracking-[-0.01em]">{group.name}</p>
              <p className="mt-[3px] text-xs text-ink-2">{groupHint(group)}</p>
            </div>
            <span className="ml-auto flex-none rounded-chip bg-paper-2 px-2 py-1 text-[11px] font-semibold text-ink-2 tabular-nums">
              {groupBadge(group, selection)}
            </span>
          </div>
          {group.options.map((option) => {
            const on = (selection[group.id] ?? []).includes(option.id);
            return (
              <label
                key={option.id}
                className={`flex min-h-12 cursor-pointer items-center gap-3 border-t px-4 py-[13px] ${
                  on ? "border-action/15 bg-action/5" : "border-paper-3 hover:bg-paper-soft"
                }`}
              >
                <input
                  type="checkbox"
                  className="peer sr-only"
                  checked={on}
                  onChange={() => setSelection((current) => toggleOption(current, group, option.id))}
                />
                <span
                  aria-hidden="true"
                  className={`flex size-5 flex-none items-center justify-center rounded-md peer-focus-visible:ring-2 peer-focus-visible:ring-action peer-focus-visible:ring-offset-2 ${
                    on ? "bg-action text-white" : "border-[1.5px] border-line-control"
                  }`}
                >
                  {on && <CheckIcon size={12} />}
                </span>
                <span className={`min-w-0 text-[15px] ${on ? "font-medium" : ""}`}>{option.name}</span>
                <span className={`ml-auto flex-none text-[13px] tabular-nums ${on ? "font-semibold text-action" : "text-ink-2"}`}>
                  {optionPriceLabel(group, option)}
                </span>
              </label>
            );
          })}
        </fieldset>
      ))}

      <div className="mt-[22px] border-t border-paper-3 p-4">
        <label htmlFor="observacao" className="text-base font-semibold tracking-[-0.01em]">
          Observação
        </label>
        <textarea
          id="observacao"
          rows={2}
          maxLength={NOTE_MAX_LENGTH}
          placeholder="ex.: sem cebola"
          value={note}
          onChange={(event) => setNote(event.currentTarget.value)}
          className={`mt-2.5 w-full resize-none px-3.5 py-3 ${FIELD_BOX} ${FIELD_FOCUS} ${FIELD_TEXT}`}
        />
      </div>

      {canOrder && (
        <div className="fixed inset-x-0 bottom-0 z-40 mx-auto flex max-w-[480px] flex-col gap-2.5 border-t border-paper-3 bg-paper px-4 pb-[18px] pt-3">
          <div className="flex items-center gap-3.5">
            <div className="flex items-center gap-1 rounded-field border border-line-strong p-1">
              <button
                type="button"
                aria-label="Diminuir quantidade"
                disabled={quantity === 1}
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                className="flex size-11 items-center justify-center rounded-lg text-ink-2 hover:bg-paper-2 disabled:text-ink-3/50"
              >
                <MinusIcon />
              </button>
              <span className="min-w-[26px] text-center text-base font-semibold tabular-nums" aria-live="polite">
                {quantity}
              </span>
              <button
                type="button"
                aria-label="Aumentar quantidade"
                onClick={() => setQuantity((q) => q + 1)}
                className="flex size-11 items-center justify-center rounded-lg text-ink-2 hover:bg-paper-2"
              >
                <PlusIcon />
              </button>
            </div>
            <div className="ml-auto text-right">
              <p className="text-[11px] text-ink-3">Total do item</p>
              <p className="text-xl font-semibold tracking-[-0.02em] tabular-nums">{formatCents(unit * quantity)}</p>
            </div>
          </div>
          {missing ? (
            <button type="button" disabled className="min-h-[52px] rounded-field bg-paper-muted text-[15px] font-semibold text-ink-2">
              {lockReason(missing)}
            </button>
          ) : (
            <button type="button" onClick={add} className="min-h-[52px] rounded-field bg-action text-base font-semibold text-white">
              Adicionar ao carrinho
            </button>
          )}
        </div>
      )}
    </main>
  );
}
