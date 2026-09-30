"use client";

import { useState } from "react";
import { trackingPath } from "@/lib/active-order.ts";
import type { OrderReceipt } from "@/lib/api.ts";
import { formatCents } from "@/lib/money.ts";
import { CheckIcon } from "./icons.tsx";

const BODY = {
  takeaway: "A loja vai confirmar e avisar quando estiver pronto para retirada.",
  delivery: "A loja vai confirmar o pedido e você acompanha a entrega por aqui.",
} as const;

/**
 * O fim do pedido. No salão não há acompanhamento (a mesa não recebe token);
 * pelo link, o comprovante traz o link — que "não se recupera" fora do
 * aparelho, e por isso pode ser copiado. Tudo sai do que a loja GRAVOU.
 */
export function SentScreen({
  receipt,
  expectedTotal,
  slug,
  onRestart,
}: {
  receipt: OrderReceipt;
  /** O total que o aparelho mostrou antes de enviar. */
  expectedTotal: number;
  slug: string;
  onRestart: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const dineIn = receipt.type === "dine_in";
  const path = receipt.trackingToken ? trackingPath(slug, receipt.id, receipt.trackingToken) : null;
  const fee =
    receipt.type !== "delivery"
      ? null
      : receipt.deliveryFeeInCents === null
        ? "A combinar"
        : receipt.deliveryFeeInCents === 0
          ? "Grátis"
          : formatCents(receipt.deliveryFeeInCents);

  return (
    <main className="flex min-h-dvh flex-col px-5 pb-40 pt-12">
      <span className="sent-badge relative flex size-[60px] items-center justify-center rounded-full bg-success-soft text-success" aria-hidden="true">
        <CheckIcon size={30} />
      </span>
      <h1 className="mt-5 text-[26px] font-semibold leading-[1.15] tracking-[-0.03em]">
        {dineIn ? "Pedido enviado para a cozinha" : "Pedido enviado"}
      </h1>
      <p className="mt-2.5 text-[15px] leading-normal text-ink-2">
        {dineIn
          ? receipt.table
            ? `É só aguardar na ${receipt.table.label}. A comida chega até você.`
            : "É só aguardar. Avise o garçom em qual mesa você está."
          : BODY[receipt.type as keyof typeof BODY]}
      </p>

      <div className="mt-6 flex flex-col gap-2.5 rounded-card border border-paper-3 p-4">
        {receipt.items.map((item, index) => (
          <div key={index} className="flex gap-2 text-sm">
            <span className="tabular-nums text-ink-2">{item.quantity}×</span>
            <span className="min-w-0">{item.name}</span>
            <span className="ml-auto tabular-nums">{formatCents(item.unitPriceInCents * item.quantity)}</span>
          </div>
        ))}
        {fee !== null && (
          <div className="flex text-sm">
            <span className="text-ink-2">Entrega</span>
            <span className="ml-auto tabular-nums">{fee}</span>
          </div>
        )}
        <div className="flex border-t border-paper-3 pt-2.5">
          <span className="text-sm font-semibold">TOTAL</span>
          <span className="ml-auto text-lg font-semibold tabular-nums">{formatCents(receipt.totalInCents)}</span>
        </div>
      </div>

      {receipt.totalInCents !== expectedTotal && (
        <p role="status" className="mt-3 rounded-field bg-warn-soft px-3.5 py-2.5 text-[13px] text-warn">
          O total mudou: a loja atualizou o preço de algum item. Vale o valor acima.
        </p>
      )}

      {path && (
        <div className="mt-4 rounded-card bg-paper-2 p-4">
          <p className="text-sm font-semibold">Guarde este link — ele não se recupera</p>
          <p className="mt-1 break-all text-[13px] text-ink-2">{path}</p>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(`${window.location.origin}${path}`).then(() => setCopied(true));
            }}
            className="mt-1 min-h-11 text-[13px] font-semibold text-action"
          >
            {copied ? "Link copiado" : "Copiar link"}
          </button>
        </div>
      )}

      <div className="fixed inset-x-0 bottom-0 z-40 mx-auto flex max-w-[480px] flex-col gap-2 border-t border-paper-3 bg-paper px-4 pb-[18px] pt-3">
        {path && (
          <a href={path} className="flex min-h-[52px] w-full items-center justify-center rounded-field bg-action text-base font-semibold text-white">
            Acompanhar pedido
          </a>
        )}
        <button
          type="button"
          onClick={onRestart}
          className={
            path
              ? "min-h-11 w-full text-sm font-semibold text-ink-2"
              : "min-h-[52px] w-full rounded-field bg-action text-base font-semibold text-white"
          }
        >
          Voltar ao cardápio
        </button>
      </div>
    </main>
  );
}
