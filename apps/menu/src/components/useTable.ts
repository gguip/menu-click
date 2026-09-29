"use client";

import { useEffect, useState } from "react";
import { resolveTable } from "@/lib/api.ts";
import { type TableState, tableHashFromSearch } from "@/lib/table.ts";

/**
 * Lê `?mesa=` NO NAVEGADOR, depois de montar. Ler no servidor (ou pelo hook
 * de querystring do Next, que manda tudo até o limite de suspensão mais
 * próximo para o navegador) tiraria o cardápio do HTML do ISR. `override` é
 * para teste.
 */
export function useTable(slug: string, override?: TableState): TableState {
  const [table, setTable] = useState<TableState>(override ?? { kind: "none" });

  useEffect(() => {
    if (override) return;
    const hash = tableHashFromSearch(window.location.search);
    if (!hash) return;
    let alive = true;
    setTable({ kind: "resolving", hash });
    void resolveTable(slug, hash).then((found) => {
      if (!alive) return;
      setTable(found.kind === "found" ? { kind: "found", hash, label: found.label } : { kind: found.kind, hash });
    });
    return () => {
      alive = false;
    };
  }, [slug, override]);

  return override ?? table;
}
