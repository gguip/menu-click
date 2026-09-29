"use client";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { resolveTable } from "@/lib/api.ts";
import type { Menu } from "@/lib/types.ts";
import { MenuApp } from "./MenuApp.tsx";

/** Lê ?mesa= no navegador e resolve o rótulo. Mesa que não resolve não trava nada. */
export function TableResolver({ menu }: { menu: Menu }) {
  const hash = useSearchParams().get("mesa");
  const [label, setLabel] = useState<string | null>(null);
  const [unknown, setUnknown] = useState(false);

  useEffect(() => {
    if (!hash) return;
    let alive = true;
    void resolveTable(menu.restaurant.slug, hash).then((found) => {
      if (!alive) return;
      setLabel(found);
      setUnknown(found === null);
    });
    return () => {
      alive = false;
    };
  }, [hash, menu.restaurant.slug]);

  return <MenuApp menu={menu} tableHash={unknown ? null : hash} tableLabel={label} tableUnknown={unknown} />;
}
