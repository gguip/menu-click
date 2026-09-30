"use client";

import { useEffect, useRef, useState } from "react";
import { activeSectionIndex, overflowEdges } from "@/lib/tabs.ts";
import type { MenuSection } from "@/lib/types.ts";
import { sectionAnchor } from "./ProductGrid.tsx";

/** Tempo para a rolagem suave de um toque na aba acabar antes de a rolagem voltar a mandar. */
const CLICK_LOCK_MS = 700;

/**
 * As abas das seções, fixas no topo. Com muita seção elas rolam para o lado,
 * e três coisas deixam isso descobrível: um degradê na borda que ainda tem aba
 * escondida, setas no computador (mouse comum não arrasta na horizontal) e a
 * aba ativa que acompanha a rolagem do cardápio — e rola para ficar à vista.
 *
 * `sections` é a lista que a tela mostra (já filtrada pela busca), a mesma que
 * a grade usa para as âncoras: as duas contam o índice do mesmo jeito.
 */
export function SectionTabs({ sections, top }: { sections: MenuSection[]; top: "top-0" | "top-[42px]" }) {
  const nav = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [edges, setEdges] = useState({ left: false, right: false });
  const lockUntil = useRef(0);

  const current = Math.min(active, Math.max(0, sections.length - 1));

  const measureEdges = () => {
    const el = nav.current;
    if (el) setEdges(overflowEdges(el.scrollLeft, el.clientWidth, el.scrollWidth));
  };

  // a aba ativa segue a seção que está na tela
  useEffect(() => {
    const onScroll = () => {
      if (Date.now() < lockUntil.current || !nav.current) return;
      const stickyBottom = nav.current.getBoundingClientRect().bottom + 1;
      const tops = sections.map(
        (_, index) => document.getElementById(sectionAnchor(index))?.getBoundingClientRect().top ?? Infinity,
      );
      const atPageEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      setActive(activeSectionIndex(tops, stickyBottom, atPageEnd));
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [sections]);

  // …e fica no meio da barra: nas pontas ela ficaria embaixo da seta e do degradê
  useEffect(() => {
    const el = nav.current;
    const tab = el?.children[current] as HTMLElement | undefined;
    if (!el || !tab) return;
    el.scrollTo?.({ left: tab.offsetLeft - (el.clientWidth - tab.offsetWidth) / 2, behavior: "smooth" });
  }, [current]);

  useEffect(() => {
    measureEdges();
    window.addEventListener("resize", measureEdges);
    return () => window.removeEventListener("resize", measureEdges);
  }, [sections]);

  const go = (index: number) => {
    setActive(index);
    lockUntil.current = Date.now() + CLICK_LOCK_MS;
    const section = document.getElementById(sectionAnchor(index));
    const stickyBottom = nav.current?.getBoundingClientRect().bottom ?? 0;
    if (section) {
      window.scrollTo?.({ top: section.getBoundingClientRect().top + window.scrollY - stickyBottom, behavior: "smooth" });
    }
  };

  const page = (direction: 1 | -1) => {
    const el = nav.current;
    el?.scrollBy?.({ left: direction * el.clientWidth * 0.7, behavior: "smooth" });
  };

  return (
    <div className={`sticky z-20 mt-4 border-b border-paper-3 bg-paper ${top}`}>
      <div
        ref={nav}
        role="tablist"
        aria-label="Seções do cardápio"
        onScroll={measureEdges}
        className="flex gap-[22px] overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {sections.map((section, index) => (
          <button
            key={section.id ?? section.name}
            type="button"
            role="tab"
            aria-selected={index === current}
            onClick={() => go(index)}
            className={`min-h-11 flex-none whitespace-nowrap pb-2.5 pt-3 text-sm ${
              index === current
                ? "font-semibold text-action shadow-[inset_0_-2px_0_var(--brand-action)]"
                : "font-medium text-ink-2 hover:text-ink"
            }`}
          >
            {section.name}
          </button>
        ))}
      </div>

      {/* o degradê só aparece do lado que ainda tem aba escondida */}
      {edges.left && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-paper to-paper/0" />
      )}
      {edges.right && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-paper to-paper/0" />
      )}

      {/* setas só com mouse: no toque, arrastar já resolve */}
      {edges.left && (
        <button
          type="button"
          aria-label="Ver seções anteriores"
          onClick={() => page(-1)}
          className="absolute inset-y-0 left-0 hidden w-9 items-center justify-center bg-paper text-ink-2 hover:text-ink pointer-fine:flex"
        >
          <Chevron direction="left" />
        </button>
      )}
      {edges.right && (
        <button
          type="button"
          aria-label="Ver mais seções"
          onClick={() => page(1)}
          className="absolute inset-y-0 right-0 hidden w-9 items-center justify-center bg-paper text-ink-2 hover:text-ink pointer-fine:flex"
        >
          <Chevron direction="right" />
        </button>
      )}
    </div>
  );
}

function Chevron({ direction }: { direction: "left" | "right" }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden="true">
      <path d={direction === "left" ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"} />
    </svg>
  );
}
