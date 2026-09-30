// apps/menu/src/components/TrackingView.tsx
"use client";

import { type CSSProperties, useEffect, useState } from "react";
import { clearActiveOrder, loadActiveOrder } from "@/lib/active-order.ts";
import { formatCents } from "@/lib/money.ts";
import { type SocketLike, startTracker, type TrackerState } from "@/lib/tracker.ts";
import {
  estimateText,
  fetchTrackedOrder,
  isFinished,
  trackHeadline,
  trackingSocketUrl,
  trackSteps,
} from "@/lib/tracking.ts";
import type { MenuRestaurant } from "@/lib/types.ts";
import { CheckIcon } from "./icons.tsx";

const INITIAL: TrackerState = { order: null, mode: "polling", updatedAt: null, notFound: false };

/**
 * O acompanhamento. O token vem da querystring, lido depois de montar (a
 * página é a mesma para qualquer token). Aba que volta a ficar visível
 * consulta na hora: o celular suspende o socket em segundo plano.
 */
export function TrackingView({ restaurant, orderId }: { restaurant: MenuRestaurant; orderId: string }) {
  const [state, setState] = useState<TrackerState>(INITIAL);
  const [missingToken, setMissingToken] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("t");
    if (!token) {
      setMissingToken(true);
      return;
    }
    const tracker = startTracker(
      {
        fetchOrder: () => fetchTrackedOrder(orderId, token),
        // o WebSocket do navegador tem handlers com parâmetro (`ev: Event`); o
        // transporte só usa o que o `SocketLike` descreve
        openSocket: () => new WebSocket(trackingSocketUrl(orderId, token)) as unknown as SocketLike,
        now: () => Date.now(),
      },
      setState,
    );
    const onVisible = () => {
      if (document.visibilityState === "visible") tracker.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    const tick = setInterval(() => setNow(Date.now()), 5000);
    return () => {
      tracker.stop();
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [orderId]);

  // terminou: o aparelho esquece o pedido (nunca vira histórico)
  const finished = state.order !== null && isFinished(state.order.status);
  useEffect(() => {
    if (!finished) return;
    if (loadActiveOrder(restaurant.slug)?.orderId === orderId) clearActiveOrder(restaurant.slug);
  }, [finished, restaurant.slug, orderId]);

  const brand = { "--brand-action": restaurant.brandColor ?? "#1E5AE8" } as CSSProperties;
  const back = (
    <a href={`/${restaurant.slug}`} className="mt-6 flex min-h-11 items-center justify-center text-sm font-semibold text-ink-2">
      Voltar ao cardápio
    </a>
  );

  if (missingToken || state.notFound) {
    return (
      <main style={brand} className="mx-auto min-h-dvh max-w-[480px] bg-paper px-5 pt-16 text-ink">
        <h1 className="text-[22px] font-semibold">Não encontramos este pedido</h1>
        <p className="mt-2 text-[15px] text-ink-2">Confira se o link está completo, do jeito que apareceu ao enviar o pedido.</p>
        {back}
      </main>
    );
  }

  const order = state.order;
  if (order === null) {
    return (
      <main style={brand} className="mx-auto min-h-dvh max-w-[480px] bg-paper px-5 pt-16 text-ink">
        <p className="text-[15px] text-ink-2">Carregando o pedido…</p>
      </main>
    );
  }

  const tz = restaurant.timezone;
  const estimate = estimateText(order, tz);
  const seconds = state.updatedAt === null ? null : Math.max(0, Math.round((now - state.updatedAt) / 1000));
  const cancelled = order.status === "cancelled";
  const address = restaurant.address;

  return (
    <main style={brand} className="mx-auto min-h-dvh max-w-[480px] bg-paper px-5 pb-10 pt-8 text-ink">
      <p className="text-[13px] font-semibold text-ink-2">{restaurant.name}</p>
      {!finished && (
        <p role="status" className="mt-3 flex items-center gap-2 text-[13px] text-ink-2">
          <span aria-hidden="true" className={`size-2 rounded-full ${state.mode === "live" ? "bg-success" : "bg-line-strong"}`} />
          {state.mode === "live" ? "Atualizando em tempo real" : seconds === null ? "Atualizando…" : `Atualizado há ${seconds} s`}
        </p>
      )}
      <h1 className="mt-2 text-[26px] font-semibold leading-[1.15] tracking-[-0.03em]">{trackHeadline(order)}</h1>
      {estimate && <p className="mt-2 text-sm text-ink-2">{estimate}</p>}
      {cancelled && <p className="mt-2 text-[15px] text-ink-2">{order.cancellationReason ?? "A loja cancelou este pedido."}</p>}

      {order.type === "takeaway" && (
        <div className="mt-4 rounded-card bg-paper-2 p-4 text-sm">
          <p className="font-semibold">Pedido #{order.number}</p>
          <p className="mt-1 text-ink-2">
            Retire em {address.street}, {address.number} — {address.neighborhood}
          </p>
        </div>
      )}

      {!cancelled && (
        <ol className="mt-6 flex flex-col gap-3">
          {trackSteps(order, tz).map((step) => (
            <li key={step.label} className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className={`flex size-6 flex-none items-center justify-center rounded-full ${step.done ? "bg-action text-white" : "border-[1.5px] border-line-control"}`}
              >
                {step.done && <CheckIcon size={13} />}
              </span>
              <span className={`text-[15px] ${step.done ? "font-semibold" : "text-ink-3"}`}>{step.label}</span>
              <span className="ml-auto text-sm tabular-nums text-ink-2">{step.time ?? "—"}</span>
            </li>
          ))}
        </ol>
      )}

      <section className="mt-8 rounded-card border border-paper-3 p-4">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.1em] text-ink-3">Seu pedido</h2>
        <ul className="mt-3 flex flex-col gap-2.5">
          {order.items.map((item, index) => (
            <li key={index} className="flex gap-2 text-sm">
              <span className="tabular-nums text-ink-2">{item.quantity}×</span>
              <div className="min-w-0">
                <p>{item.name}</p>
                {item.options && item.options.length > 0 && (
                  <p className="text-xs text-ink-2">{item.options.map((o) => o.name).join(" · ")}</p>
                )}
                {item.note && <p className="text-xs text-ink-2">Obs.: {item.note}</p>}
              </div>
              <span className="ml-auto tabular-nums">{formatCents(item.unitPriceInCents * item.quantity)}</span>
            </li>
          ))}
        </ul>
        {order.type === "delivery" && (
          <div className="mt-2.5 flex text-sm">
            <span className="text-ink-2">Entrega</span>
            <span className="ml-auto tabular-nums">
              {order.deliveryFeeInCents === null ? "A combinar" : order.deliveryFeeInCents === 0 ? "Grátis" : formatCents(order.deliveryFeeInCents)}
            </span>
          </div>
        )}
        <div className="mt-2.5 flex border-t border-paper-3 pt-2.5">
          <span className="text-sm font-semibold">TOTAL</span>
          <span className="ml-auto text-lg font-semibold tabular-nums">{formatCents(order.totalInCents)}</span>
        </div>
      </section>
      {back}
    </main>
  );
}
