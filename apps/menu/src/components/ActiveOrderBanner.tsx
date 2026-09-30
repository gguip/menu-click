// apps/menu/src/components/ActiveOrderBanner.tsx
"use client";

import { useEffect, useState } from "react";
import { clearActiveOrder, loadActiveOrder, trackingPath } from "@/lib/active-order.ts";
import { fetchTrackedOrder, isFinished } from "@/lib/tracking.ts";

/**
 * "Você tem um pedido em andamento": o caminho de volta para quem fechou a
 * aba. Confere o pedido antes de mostrar — terminado ou inexistente sai do
 * aparelho sem faixa. Sem rede, mostra (é melhor um link a mais que um a menos).
 */
export function ActiveOrderBanner({ slug }: { slug: string }) {
  const [href, setHref] = useState<string | null>(null);

  useEffect(() => {
    const active = loadActiveOrder(slug);
    if (!active) return;
    let alive = true;
    fetchTrackedOrder(active.orderId, active.token).then(
      (order) => {
        if (!alive) return;
        if (order === "not-found" || isFinished(order.status)) {
          clearActiveOrder(slug);
          return;
        }
        setHref(trackingPath(slug, active.orderId, active.token));
      },
      () => {
        if (alive) setHref(trackingPath(slug, active.orderId, active.token));
      },
    );
    return () => {
      alive = false;
    };
  }, [slug]);

  if (href === null) return null;
  return (
    <div className="mx-4 mt-3 flex items-center gap-3 rounded-field bg-action/10 px-3.5 py-2.5 text-[13px]">
      <span className="font-semibold">Você tem um pedido em andamento</span>
      <a href={href} className="ml-auto min-h-11 content-center font-semibold text-action">
        Acompanhar
      </a>
    </div>
  );
}
