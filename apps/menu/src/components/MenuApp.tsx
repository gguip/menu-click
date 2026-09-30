"use client";

import { type CSSProperties, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { fetchLiveRestaurant, type OrderReceipt } from "@/lib/api.ts";
import { canOrderByLink, linkModalities, minimumHint } from "@/lib/link-order.ts";
import { addLine, type CartLine, cartStorageKey, loadCart, reconcileCart, saveCart, subtotal } from "@/lib/cart.ts";
import { formatCents } from "@/lib/money.ts";
import { orderTableHash, type TableState, tableHashOf, tableLabelOf } from "@/lib/table.ts";
import type { Menu, MenuProduct, MenuRestaurant, MenuSection } from "@/lib/types.ts";
import { SearchIcon, TableIcon } from "./icons.tsx";
import { CartScreen } from "./CartScreen.tsx";
import { CheckoutScreen } from "./CheckoutScreen.tsx";
import { LinkCheckout } from "./LinkCheckout.tsx";
import { MenuHeader } from "./MenuHeader.tsx";
import { ProductScreen } from "./ProductScreen.tsx";
import { ProductGrid } from "./ProductGrid.tsx";
import { SectionTabs } from "./SectionTabs.tsx";
import { SentScreen } from "./SentScreen.tsx";
import { StoreNotice } from "./StoreNotice.tsx";
import { FIELD_BOX, FIELD_FOCUS_WITHIN, FIELD_TEXT } from "./field.ts";
import { useTable } from "./useTable.ts";

export type Screen = "menu" | "product" | "cart" | "checkout" | "sent";

/**
 * O que cada entrada do histórico guarda. O Next copia o estado interno dele
 * para dentro do nosso no `pushState` (e trata o `popstate` como a mesma
 * página), então as telas convivem com o roteador.
 */
type HistoryState = { menuScreen?: Screen; productId?: string; step?: number } | null;

/** Sem acento e sem caixa: "calab" acha "Calabresa", "acai" acha "Açaí". */
function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

function filterSections(sections: MenuSection[], query: string): MenuSection[] {
  const q = fold(query.trim());
  if (q === "") return sections;
  return sections
    .map((section) => ({
      ...section,
      products: section.products.filter((p) => fold(`${p.name} ${p.description ?? ""}`).includes(q)),
    }))
    .filter((section) => section.products.length > 0);
}

/**
 * O app do cliente numa página só: cardápio, produto, carrinho, finalizar e
 * enviado são telas deste componente. O cardápio chega pronto do servidor
 * (ISR); o que é do momento — horário, pausa, mesa, carrinho — vive aqui.
 */
export function MenuApp({
  menu,
  table: tableOverride,
  now: fixedNow,
  initialScreen = "menu",
}: {
  menu: Menu;
  /** A mesa já resolvida, para teste; padrão, `?mesa=` lido no navegador. */
  table?: TableState;
  /** Relógio injetável para teste; padrão, a hora do navegador. */
  now?: number;
  /** Só para teste de estado de tela. */
  initialScreen?: Screen;
}) {
  const [restaurant, setRestaurant] = useState<MenuRestaurant>(menu.restaurant);
  const table = useTable(menu.restaurant.slug, tableOverride);
  const tableHash = tableHashOf(table);
  const tableLabel = tableLabelOf(table);
  // `null` no servidor e na hidratação: o HTML do cache é lido noutra hora, e
  // "abre amanhã" escrito lá viraria erro de hidratação. A hora entra depois.
  const [now, setNow] = useState<number | null>(fixedNow ?? null);
  useEffect(() => {
    if (fixedNow === undefined) setNow(Date.now());
  }, [fixedNow]);
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const [checkoutStep, setCheckoutStep] = useState(0);
  const [query, setQuery] = useState("");
  // a chave vem do cardápio da página, que não muda: o status ao vivo não mexe nela
  const storageKey = cartStorageKey(menu.restaurant.slug, tableHash);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [cartUpdated, setCartUpdated] = useState(false);
  const [product, setProduct] = useState<MenuProduct | null>(null);
  // o que a loja gravou, e o que o aparelho esperava — o carrinho já foi limpo
  const [sent, setSent] = useState<{ receipt: OrderReceipt; expectedTotal: number } | null>(null);

  // O cardápio da página tem até 60 s (ISR); horário e pausa são de AGORA.
  useEffect(() => {
    let alive = true;
    void fetchLiveRestaurant(menu.restaurant.slug).then((live) => {
      if (!alive || !live) return;
      // só o que é do MOMENTO; o resto do cardápio é o da página
      setRestaurant((current) => ({
        ...current,
        isOpen: live.isOpen,
        acceptingOrders: live.acceptingOrders,
        closesAt: live.closesAt,
        opensAt: live.opensAt,
        // o interruptor de salão também é do momento: desligado depois do
        // cache, a pessoa montaria o carrinho para levar 409 no "Enviar"
        isQrcode: typeof live.isQrcode === "boolean" ? live.isQrcode : current.isQrcode,
        isDelivery: typeof live.isDelivery === "boolean" ? live.isDelivery : current.isDelivery,
        isTakeaway: typeof live.isTakeaway === "boolean" ? live.isTakeaway : current.isTakeaway,
      }));
    });
    return () => {
      alive = false;
    };
  }, [menu.restaurant.slug]);

  // Carrinho por loja e por mesa, lido depois de montar (o servidor não tem
  // storage) e conferido contra o cardápio desta página: o guardado não tem
  // prazo, e o que o servidor recusaria sai antes de a pessoa tentar.
  useEffect(() => {
    const { lines: fresh, changed } = reconcileCart(loadCart(storageKey), menu);
    setLines(fresh);
    setCartUpdated(changed);
    if (changed) saveCart(storageKey, fresh);
  }, [storageKey, menu]);

  const updateLines = (next: CartLine[]) => {
    setLines(next);
    saveCart(storageKey, next);
  };

  const sections = useMemo(() => filterSections(menu.sections, query), [menu.sections, query]);
  const inDineIn = tableHash !== null;
  // Na parte 1 só o salão monta pedido: o link (entrega/retirada) é a parte 2.
  // mesa: o salão; link: entrega ou retirada
  const canOrder = inDineIn ? restaurant.isOpen && restaurant.isQrcode : canOrderByLink(restaurant);
  const count = lines.reduce((sum, line) => sum + line.quantity, 0);
  const brand = { "--brand-action": restaurant.brandColor ?? "#1E5AE8" } as CSSProperties;

  // Cada tela é uma entrada do histórico: o voltar do celular (e o da tela,
  // que chama o mesmo `history.back()`) anda pelas telas em vez de sair do app.
  const menuScroll = useRef<number | null>(null);
  const products = useMemo(() => menu.sections.flatMap((section) => section.products), [menu.sections]);

  const show = (next: Screen, productId?: string, step = 0) => {
    setCheckoutStep(step);
    const chosen = productId ? products.find((p) => p.id === productId) : undefined;
    if (next === "product" && !chosen) {
      setScreen("menu");
      return;
    }
    if (chosen) setProduct(chosen);
    setScreen(next);
  };

  const go = (next: Screen, productId?: string) => {
    if (screen === "menu") menuScroll.current = window.scrollY;
    window.history.pushState({ menuScreen: next, productId, step: 0 } satisfies HistoryState, "");
    show(next, productId);
    window.scrollTo?.(0, 0);
  };

  const back = () => window.history.back();

  // cada passo do finalizar é uma entrada do histórico: o voltar do celular
  // volta um passo, e o voltar da tela (history.back) faz o mesmo
  const goStep = (step: number) => {
    window.history.pushState({ menuScreen: "checkout", step } satisfies HistoryState, "");
    setCheckoutStep(step);
    window.scrollTo?.(0, 0);
  };

  const finish = (receipt: OrderReceipt) => {
    setSent({ receipt, expectedTotal: subtotal(lines) + (receipt.deliveryFeeInCents ?? 0) });
    updateLines([]);
    // o finalizar vira o comprovante: voltar não reabre um pedido enviado
    window.history.replaceState({ menuScreen: "sent" } satisfies HistoryState, "");
    setScreen("sent");
    window.scrollTo?.(0, 0);
  };

  useEffect(() => {
    const onPop = (event: PopStateEvent) => {
      const state = event.state as HistoryState;
      show(state?.menuScreen ?? "menu", state?.productId, state?.step ?? 0);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  });

  // de volta ao cardápio, na altura em que a pessoa estava
  useLayoutEffect(() => {
    if (screen !== "menu" || menuScroll.current === null) return;
    window.scrollTo?.(0, menuScroll.current);
    menuScroll.current = null;
  }, [screen]);

  const openProduct = (chosen: MenuProduct) => go("product", chosen.id);

  return (
    <div style={brand} className="mx-auto min-h-dvh max-w-[480px] bg-paper text-ink">
      {/* A faixa da mesa acompanha cardápio e produto; carrinho e finalizar
          dizem a mesa no próprio cabeçalho, e o comprovante, na frase. */}
      {tableLabel && (screen === "menu" || screen === "product") && (
        <div className="sticky top-0 z-30 flex items-center gap-2 bg-action px-4 py-[11px] text-white">
          <TableIcon size={15} />
          <span className="text-sm font-semibold">{tableLabel}</span>
          <span className="ml-auto text-xs text-white/80">Pedido no salão</span>
        </div>
      )}

      {screen === "menu" && (
        <main className="pb-32">
          <MenuHeader restaurant={restaurant} inDineIn={inDineIn} />
          <StoreNotice
            restaurant={restaurant}
            tableUnknown={table.kind === "not-found"}
            dineInOff={inDineIn && !restaurant.isQrcode}
            linkOff={!inDineIn && linkModalities(restaurant).length === 0}
            now={now}
          />

          {menu.sections.length === 0 ? (
            <section className="px-4 pt-8">
              <h2 className="text-[19px] font-semibold">Cardápio ainda não publicado</h2>
              <p className="mt-1 text-[15px] text-ink-2">A loja está montando os pratos. Volte em breve.</p>
            </section>
          ) : (
            <>
              <div className="px-4 pt-3.5">
                <label data-field className={`flex items-center gap-2.5 px-3.5 text-ink-3 ${FIELD_BOX} ${FIELD_FOCUS_WITHIN}`}>
                  <SearchIcon size={17} />
                  <input
                    type="search"
                    aria-label="Buscar no cardápio"
                    placeholder="Buscar no cardápio"
                    value={query}
                    onChange={(event) => setQuery(event.currentTarget.value)}
                    className={`w-full bg-transparent py-3.5 focus:outline-none ${FIELD_TEXT}`}
                  />
                </label>
              </div>

              <SectionTabs sections={sections} top={tableLabel ? "top-[42px]" : "top-0"} />

              {sections.length === 0 ? (
                <p className="px-4 pt-6 text-[15px] text-ink-2">Nada encontrado para “{query.trim()}”.</p>
              ) : (
                <ProductGrid sections={sections} groups={menu.optionGroups} onOpen={openProduct} />
              )}
            </>
          )}
        </main>
      )}

      {screen === "product" && product && (
        <ProductScreen
          product={product}
          groups={menu.optionGroups}
          canOrder={canOrder}
          onBack={back}
          onAdd={(line) => {
            updateLines(addLine(lines, line));
            back();
          }}
        />
      )}

      {screen === "cart" && (
        <CartScreen
          lines={lines}
          context={tableLabel ?? (inDineIn ? "" : "Entrega ou retirada")}
          totalLabel={inDineIn ? "Total" : "Itens"}
          hint={inDineIn ? null : minimumHint(restaurant, subtotal(lines))}
          notice={cartUpdated ? "Atualizamos seu carrinho com o cardápio de agora." : null}
          onChange={updateLines}
          onBack={back}
          onCheckout={() => go("checkout")}
        />
      )}

      {screen === "checkout" && inDineIn && (
        <CheckoutScreen
          restaurant={restaurant}
          lines={lines}
          tableHash={orderTableHash(table)}
          onBack={back}
          onSent={finish}
        />
      )}

      {screen === "checkout" && !inDineIn && (
        <LinkCheckout
          restaurant={restaurant}
          lines={lines}
          step={checkoutStep}
          onStep={goStep}
          onBack={back}
          onSent={({ receipt }) => finish(receipt)}
        />
      )}

      {screen === "sent" && sent && (
        <SentScreen
          receipt={sent.receipt}
          expectedTotal={sent.expectedTotal}
          slug={menu.restaurant.slug}
          onRestart={() => {
            window.history.replaceState({ menuScreen: "menu" } satisfies HistoryState, "");
            setScreen("menu");
          }}
        />
      )}

      {screen === "menu" && canOrder && count > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-[480px] bg-gradient-to-b from-white/0 via-white to-white px-4 pb-5 pt-3">
          <button
            type="button"
            onClick={() => go("cart")}
            className="flex min-h-[52px] w-full items-center gap-3 rounded-field bg-action px-[18px] text-white"
          >
            <span className="rounded-chip bg-white/20 px-2 py-[3px] text-[13px] font-semibold tabular-nums">{count}</span>
            <span className="text-base font-semibold tracking-[-0.01em]">Ver carrinho</span>
            <span className="ml-auto text-base font-semibold tabular-nums">{formatCents(subtotal(lines))}</span>
          </button>
        </div>
      )}
    </div>
  );
}
