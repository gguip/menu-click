// apps/menu/src/components/LinkCheckout.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { saveActiveOrder } from "@/lib/active-order.ts";
import { createOrder, OrderError, type OrderReceipt } from "@/lib/api.ts";
import { type CartLine, subtotal } from "@/lib/cart.ts";
import { formatPhone } from "@/lib/checkout.ts";
import { clearCustomer, loadCustomer, saveCustomer } from "@/lib/customer.ts";
import {
  addressComplete,
  buildLinkOrderBody,
  type ChangeChoice,
  changeError,
  deliveryBlock,
  EMPTY_ADDRESS,
  linkModalities,
  linkSteps,
  type Modality,
  NOT_SERVED_MESSAGE,
  toQuoteAddress,
} from "@/lib/link-order.ts";
import { formatCents } from "@/lib/money.ts";
import { fetchQuote, latestOnly, type Quote, quoteBlocksAdvance, quoteFee } from "@/lib/quote.ts";
import type { MenuRestaurant, PaymentMethod } from "@/lib/types.ts";
import { AddressStep } from "./checkout/AddressStep.tsx";
import { PaymentStep } from "./checkout/PaymentStep.tsx";
import { FIELD_BOX, FIELD_FOCUS, FIELD_TEXT } from "./field.ts";
import { ScreenHeader } from "./ScreenHeader.tsx";

const FIELD = `w-full px-3.5 py-3.5 ${FIELD_BOX} ${FIELD_FOCUS} ${FIELD_TEXT}`;

export type LinkSent = { receipt: OrderReceipt; modality: Modality };

/**
 * O finalizar pelo link: modalidade → dados → endereço (só entrega) →
 * pagamento. O ÍNDICE do passo vem de fora (o `MenuApp` o põe no histórico,
 * e o voltar do celular volta um passo); o que a pessoa preenche mora aqui.
 */
export function LinkCheckout({
  restaurant,
  lines,
  step,
  onStep,
  onBack,
  onSent,
}: {
  restaurant: MenuRestaurant;
  lines: CartLine[];
  step: number;
  onStep: (next: number) => void;
  onBack: () => void;
  onSent: (sent: LinkSent) => void;
}) {
  const available = linkModalities(restaurant);
  // o finalizar só existe no navegador: dá para ler o storage no estado inicial
  const [remembered, setRemembered] = useState(() => loadCustomer());
  const [modality, setModality] = useState<Modality | null>(available.length === 1 ? available[0] : null);
  const [name, setName] = useState(remembered?.name ?? "");
  const [phone, setPhone] = useState(remembered?.phone ?? "");
  const [address, setAddress] = useState(remembered?.address ?? EMPTY_ADDRESS);
  const [payment, setPayment] = useState<PaymentMethod | null>(null);
  const [change, setChange] = useState<ChangeChoice>({ exact: false, cents: null });
  const [changeText, setChangeText] = useState("");
  const [quote, setQuote] = useState<Quote>({ kind: "idle" });
  const [quoteRetry, setQuoteRetry] = useState(0);
  const [addressError, setAddressError] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; staleCart: boolean } | null>(null);
  const [sending, setSending] = useState(false);
  const latest = useRef(latestOnly()).current;

  const steps = linkSteps(available, modality);
  const index = Math.min(step, steps.length - 1);
  const current = steps[index];
  const items = subtotal(lines);
  const fee = modality === "delivery" ? quoteFee(quote) : null;
  const total = items + (fee ?? 0);

  // A cotação roda quando o endereço fica completo e a cada mudança dele; só
  // a última pedida vale (Review Focus 1).
  const quoteKey =
    modality === "delivery" && addressComplete(address) ? JSON.stringify(toQuoteAddress(address, restaurant.address)) : null;
  useEffect(() => {
    if (quoteKey === null) {
      setQuote({ kind: "idle" });
      return;
    }
    setQuote({ kind: "loading" });
    void latest(fetchQuote(restaurant.slug, JSON.parse(quoteKey), items)).then((result) => {
      if (result.current) setQuote(result.value);
    });
  }, [quoteKey, items, quoteRetry, restaurant.slug, latest]);

  const block = (): string | null => {
    switch (current) {
      case "modality":
        return modality === null ? "Escolha entrega ou retirada" : null;
      case "details":
        if (!name.trim()) return "Informe seu nome";
        return phone.replace(/\D/g, "").length < 10 ? "Informe um telefone válido" : null;
      case "address":
        return addressComplete(address) ? quoteBlocksAdvance(quote) : "Preencha o endereço";
      case "payment":
        if (payment === null) return "Escolha a forma de pagamento";
        return payment === "cash" ? changeError(total, change) : null;
    }
  };

  const send = async () => {
    if (modality === null || payment === null) return;
    setSending(true);
    setError(null);
    try {
      const receipt = await createOrder(
        restaurant.id,
        buildLinkOrderBody({ modality, name, phone, payment, change, address, lines }, restaurant.address),
      );
      saveCustomer({ name: name.trim(), phone, ...(modality === "delivery" ? { address } : {}) });
      if (receipt.trackingToken) {
        saveActiveOrder(restaurant.slug, { orderId: receipt.id, token: receipt.trackingToken });
      }
      onSent({ receipt, modality });
    } catch (cause) {
      const failure = cause instanceof OrderError ? cause : new OrderError(0, "Não deu para enviar. Tente de novo.");
      setSending(false);
      if (failure.status === 409 && failure.message === NOT_SERVED_MESSAGE) {
        setAddressError(failure.message);
        onStep(steps.indexOf("address"));
        return;
      }
      setError({
        message: failure.status === 404 ? "Algum item do seu carrinho saiu do cardápio." : failure.message,
        staleCart: failure.status === 400 || failure.status === 404,
      });
    }
  };

  const blocked = block();
  const last = index === steps.length - 1;
  const feeLabel =
    modality !== "delivery"
      ? null
      : quote.kind === "fee"
        ? formatCents(quote.cents)
        : quote.kind === "free"
          ? "Grátis"
          : "A combinar";

  return (
    <main className="pb-36">
      <ScreenHeader title="Finalizar" context={`Passo ${index + 1} de ${steps.length}`} onBack={onBack} />
      <div className="flex gap-1.5 px-4 pt-3" aria-hidden="true">
        {steps.map((s, i) => (
          <span key={s} className={`h-1 flex-1 rounded-full ${i <= index ? "bg-action" : "bg-paper-3"}`} />
        ))}
      </div>

      {current === "modality" && (
        <section className="flex flex-col gap-3 px-4 py-5">
          <h2 className="text-[19px] font-semibold tracking-[-0.02em]">Como você quer receber?</h2>
          {available.includes("delivery") && (
            <ModalityButton
              title="Entrega"
              detail="Chega no seu endereço"
              blocked={deliveryBlock(restaurant, items)}
              onPick={() => {
                setModality("delivery");
                onStep(index + 1);
              }}
            />
          )}
          {available.includes("takeaway") && (
            <ModalityButton
              title="Retirada"
              detail={`Você busca na loja · ${restaurant.address.street}, ${restaurant.address.number}`}
              blocked={null}
              onPick={() => {
                setModality("takeaway");
                onStep(index + 1);
              }}
            />
          )}
        </section>
      )}

      {current === "details" && (
        <section className="flex flex-col gap-4 px-4 py-5">
          <div>
            <h2 className="text-[19px] font-semibold tracking-[-0.02em]">Quem está pedindo?</h2>
            <p className="mt-1 text-[13px] leading-[1.45] text-ink-2">Sem cadastro. Só o nome e o telefone para a loja te achar.</p>
          </div>
          {remembered && (
            <button
              type="button"
              onClick={() => {
                clearCustomer();
                setRemembered(null);
                setName("");
                setPhone("");
                setAddress(EMPTY_ADDRESS);
              }}
              className="-my-1.5 min-h-11 self-start text-[13px] font-semibold text-action"
            >
              Não é você? Limpar dados
            </button>
          )}
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold text-ink-2">Nome</span>
            <input autoComplete="name" placeholder="Seu nome" value={name} onChange={(e) => setName(e.currentTarget.value)} className={FIELD} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold text-ink-2">Telefone</span>
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="(11) 90000-0000"
              value={phone}
              onChange={(e) => setPhone(formatPhone(e.currentTarget.value))}
              className={FIELD}
            />
          </label>
        </section>
      )}

      {current === "address" && (
        <AddressStep
          address={address}
          neighborhoods={restaurant.deliveryFeeMode === "neighborhood" ? restaurant.deliveryNeighborhoods : []}
          quote={quote}
          error={addressError}
          canSwitchToTakeaway={available.includes("takeaway")}
          onChange={(next) => {
            setAddressError(null);
            setAddress(next);
          }}
          onRetryQuote={() => setQuoteRetry((n) => n + 1)}
          onSwitchToTakeaway={() => {
            setModality("takeaway");
            onStep(linkSteps(available, "takeaway").indexOf("payment"));
          }}
        />
      )}

      {current === "payment" && modality !== null && (
        <PaymentStep
          modality={modality}
          accepted={restaurant.paymentMethods}
          payment={payment}
          change={change}
          changeText={changeText}
          itemsCents={items}
          feeLabel={feeLabel}
          totalCents={total}
          onPayment={setPayment}
          onChange={(next, text) => {
            setChange(next);
            setChangeText(text);
          }}
        />
      )}

      {error && (
        <div role="alert" className="mx-4 rounded-field border border-danger/30 px-3.5 py-3 text-sm text-danger">
          <p>{error.message}</p>
          {error.staleCart && (
            <button type="button" onClick={() => window.location.reload()} className="mt-2 min-h-11 font-semibold underline">
              Atualizar o cardápio
            </button>
          )}
        </div>
      )}

      {current !== "modality" && (
        <div className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-[480px] border-t border-paper-3 bg-paper px-4 pb-[18px] pt-3">
          {blocked ? (
            <button type="button" disabled className="min-h-[52px] w-full rounded-field bg-paper-muted text-[15px] font-semibold text-ink-2">
              {blocked}
            </button>
          ) : (
            <button
              type="button"
              disabled={sending}
              onClick={() => (last ? void send() : onStep(index + 1))}
              className="min-h-[52px] w-full rounded-field bg-action text-base font-semibold text-white disabled:opacity-70"
            >
              {sending ? "Enviando…" : last ? "Enviar pedido" : "Continuar"}
            </button>
          )}
        </div>
      )}
    </main>
  );
}

function ModalityButton({
  title,
  detail,
  blocked,
  onPick,
}: {
  title: string;
  detail: string;
  blocked: string | null;
  onPick: () => void;
}) {
  return (
    <div>
      <button
        type="button"
        disabled={blocked !== null}
        onClick={onPick}
        className="flex min-h-16 w-full flex-col items-start gap-0.5 rounded-card border border-line-strong px-4 py-3.5 text-left hover:border-action disabled:opacity-50"
      >
        <span className="text-base font-semibold">{title}</span>
        <span className="text-[13px] text-ink-2">{detail}</span>
      </button>
      {blocked && <p className="mt-1.5 text-[13px] text-warn">{blocked}</p>}
    </div>
  );
}
