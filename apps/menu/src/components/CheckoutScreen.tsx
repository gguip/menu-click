"use client";

import { useState } from "react";
import { createDineInOrder, OrderError, type OrderReceipt } from "@/lib/api.ts";
import { type CartLine, subtotal, toOrderItems } from "@/lib/cart.ts";
import { checkoutBlock, type DineInPayment, dineInPayments } from "@/lib/checkout.ts";
import { formatCents } from "@/lib/money.ts";
import type { MenuRestaurant } from "@/lib/types.ts";
import { ScreenHeader } from "./ScreenHeader.tsx";

const FIELD =
  "w-full rounded-field border border-line-strong px-3.5 py-3.5 text-base text-ink placeholder:text-ink-3 focus:border-action focus:outline-none";

/**
 * Finalizar no salão: passo único. Sem troco e sem vale-refeição — a pessoa
 * paga no caixa ao sair. O botão trava dizendo o que falta; erro da API
 * aparece com a mensagem dela e o carrinho continua intacto.
 */
export function CheckoutScreen({
  restaurant,
  lines,
  tableHash,
  onBack,
  onSent,
}: {
  restaurant: MenuRestaurant;
  lines: CartLine[];
  tableHash: string | null;
  onBack: () => void;
  onSent: (receipt: OrderReceipt) => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [payment, setPayment] = useState<DineInPayment | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<{ message: string; staleCart: boolean } | null>(null);

  const blocked = checkoutBlock({ name, phone, payment });
  const payments = dineInPayments(restaurant.paymentMethods);
  const total = subtotal(lines);

  const send = async () => {
    if (blocked || !payment) return;
    setSending(true);
    setError(null);
    const body = {
      type: "dine_in" as const,
      customer: { name: name.trim(), phone },
      items: toOrderItems(lines),
      paymentMethod: payment,
    };
    try {
      let receipt;
      try {
        receipt = await createDineInOrder(restaurant.id, tableHash ? { ...body, tableHash } : body);
      } catch (cause) {
        // 400 com mesa: o código do adesivo pode ter girado entre abrir o
        // cardápio e enviar. O salão aceita pedido sem mesa (é o que um QR
        // antigo manda), então vai de novo sem ela — se o 400 era de outra
        // coisa, a segunda tentativa falha igual e a mensagem aparece.
        if (!(cause instanceof OrderError && cause.status === 400 && tableHash)) throw cause;
        receipt = await createDineInOrder(restaurant.id, body);
      }
      onSent(receipt);
    } catch (cause) {
      const failure = cause instanceof OrderError ? cause : new OrderError(0, "Não deu para enviar. Tente de novo.");
      // 404 é produto ou opção que saiu do cardápio depois do cache: a mensagem
      // da API traz o id, que não diz nada a quem está pedindo
      const message = failure.status === 404 ? "Algum item do seu carrinho saiu do cardápio." : failure.message;
      setError({ message, staleCart: failure.status === 400 || failure.status === 404 });
      setSending(false);
    }
  };

  return (
    <main className="pb-36">
      <ScreenHeader title="Finalizar" context="Passo único" onBack={onBack} />

      <section className="flex flex-col gap-4 px-4 py-5">
        <div>
          <h2 className="text-[19px] font-semibold tracking-[-0.02em]">Quem está pedindo?</h2>
          <p className="mt-1 text-[13px] leading-[1.45] text-ink-2">Sem cadastro. Só o nome e o telefone para a loja te achar.</p>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold text-ink-2">Nome</span>
          <input
            autoComplete="name"
            placeholder="Seu nome"
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            className={FIELD}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold text-ink-2">Telefone</span>
          <input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="(11) 90000-0000"
            value={phone}
            onChange={(event) => setPhone(event.currentTarget.value)}
            className={FIELD}
          />
        </label>
      </section>

      <section className="border-t border-paper-3 px-4 py-5">
        <h2 className="text-[19px] font-semibold tracking-[-0.02em]">Como você paga?</h2>
        {payments.length === 0 && (
          <p role="status" className="mt-3 rounded-field bg-warn-soft px-3.5 py-2.5 text-[13px] text-warn">
            Nenhuma forma de pagamento está disponível no salão agora. Chame o garçom.
          </p>
        )}
        <div role="radiogroup" aria-label="Forma de pagamento" className="mt-3 overflow-hidden rounded-card border border-paper-3">
          {payments.map((option) => {
            const on = payment === option.method;
            return (
              <label
                key={option.method}
                className={`flex min-h-[52px] cursor-pointer items-center gap-3 border-b border-paper-3 px-4 last:border-b-0 ${on ? "bg-action/5" : ""}`}
              >
                <input
                  type="radio"
                  name="pagamento"
                  className="peer sr-only"
                  checked={on}
                  onChange={() => setPayment(option.method)}
                />
                <span
                  aria-hidden="true"
                  className={`size-5 flex-none rounded-full peer-focus-visible:ring-2 peer-focus-visible:ring-action peer-focus-visible:ring-offset-2 ${
                    on ? "border-[6px] border-action" : "border-[1.5px] border-line-control"
                  }`}
                />
                <span className={`text-[15px] ${on ? "font-semibold" : ""}`}>{option.label}</span>
              </label>
            );
          })}
        </div>
        <p className="mt-3 flex items-start gap-2.5 rounded-field bg-paper-2 px-3.5 py-3 text-[13px] leading-[1.45] text-ink-2">
          O pagamento é no caixa, na hora de sair. Você pode pedir mais coisas antes disso.
        </p>
      </section>

      <section className="border-t border-paper-3 px-4 py-5">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.1em] text-ink-3">Resumo</h2>
        <dl className="mt-2.5 flex flex-col gap-2 text-sm">
          <div className="flex">
            <dt className="text-ink-2">Itens</dt>
            <dd className="ml-auto font-medium tabular-nums">{formatCents(total)}</dd>
          </div>
          <div className="flex border-t border-paper-3 pt-2.5">
            <dt className="text-sm font-semibold">TOTAL</dt>
            <dd className="ml-auto text-lg font-semibold tabular-nums">{formatCents(total)}</dd>
          </div>
        </dl>
      </section>

      {error && (
        <div role="alert" className="mx-4 rounded-field border border-danger/30 px-3.5 py-3 text-sm text-danger">
          <p>{error.message}</p>
          {error.staleCart && (
            <>
              <p className="mt-1">O cardápio mudou desde que você abriu. Atualize para ver o de agora — o carrinho é conferido e o que saiu é retirado.</p>
              <button type="button" onClick={() => window.location.reload()} className="mt-2 min-h-11 font-semibold underline">
                Atualizar o cardápio
              </button>
            </>
          )}
        </div>
      )}

      <div className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-[480px] border-t border-paper-3 bg-paper px-4 pb-[18px] pt-3">
        {blocked ? (
          <button type="button" disabled className="min-h-[52px] w-full rounded-field bg-paper-muted text-[15px] font-semibold text-ink-2">
            {blocked}
          </button>
        ) : (
          <button
            type="button"
            disabled={sending}
            onClick={() => void send()}
            className="min-h-[52px] w-full rounded-field bg-action text-base font-semibold text-white disabled:opacity-70"
          >
            {sending ? "Enviando…" : "Enviar para a cozinha"}
          </button>
        )}
      </div>
    </main>
  );
}
