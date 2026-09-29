import { type CartLine, subtotal } from "@/lib/cart.ts";
import { formatCents } from "@/lib/money.ts";
import { CheckIcon } from "./icons.tsx";

/**
 * O fim do pedido de salão. Sem acompanhamento, e por desenho: quem está na
 * mesa não recebe token — pede, e a comida chega. A tela tranquiliza em vez de
 * oferecer algo que não existe.
 */
export function SentScreen({
  lines,
  tableLabel,
  onRestart,
}: {
  lines: CartLine[];
  tableLabel: string | null;
  onRestart: () => void;
}) {
  const total = subtotal(lines);
  return (
    <main className="flex min-h-dvh flex-col px-5 pb-6 pt-12">
      <span className="flex size-[60px] items-center justify-center rounded-full bg-success-soft text-success" aria-hidden="true">
        <CheckIcon size={30} />
      </span>
      <h1 className="mt-5 text-[26px] font-semibold leading-[1.15] tracking-[-0.03em]">Pedido enviado para a cozinha</h1>
      <p className="mt-2.5 text-[15px] leading-normal text-ink-2">
        {tableLabel ? `É só aguardar na ${tableLabel}. A comida chega até você.` : "É só aguardar. A comida chega até você."}
      </p>

      <div className="mt-6 flex flex-col gap-2.5 rounded-card border border-paper-3 p-4">
        {lines.map((line) => (
          <div key={line.key} className="flex gap-2 text-sm">
            <span className="tabular-nums text-ink-2">{line.quantity}×</span>
            <span className="min-w-0">{line.name}</span>
            <span className="ml-auto tabular-nums">{formatCents(line.unitPriceInCents * line.quantity)}</span>
          </div>
        ))}
        <div className="flex border-t border-paper-3 pt-2.5">
          <span className="text-sm font-semibold">TOTAL</span>
          <span className="ml-auto text-lg font-semibold tabular-nums">{formatCents(total)}</span>
        </div>
      </div>

      <button type="button" onClick={onRestart} className="mt-auto min-h-11 pt-8 text-sm font-semibold text-ink-2">
        Voltar ao cardápio
      </button>
    </main>
  );
}
