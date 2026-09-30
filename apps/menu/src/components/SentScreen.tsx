import type { OrderReceipt } from "@/lib/api.ts";
import { formatCents } from "@/lib/money.ts";
import { CheckIcon } from "./icons.tsx";

/**
 * O fim do pedido de salão. Sem acompanhamento, e por desenho: quem está na
 * mesa não recebe token — pede, e a comida chega. A tela tranquiliza em vez de
 * oferecer algo que não existe.
 *
 * Tudo aqui sai do que a loja GRAVOU (`receipt`), não do carrinho: preço
 * congelado, total do servidor e a mesa que de fato entrou no pedido.
 */
export function SentScreen({
  receipt,
  expectedTotal,
  onRestart,
}: {
  receipt: OrderReceipt;
  /** O total que o aparelho mostrou antes de enviar. */
  expectedTotal: number;
  onRestart: () => void;
}) {
  return (
    <main className="flex min-h-dvh flex-col px-5 pb-28 pt-12">
      <span className="sent-badge flex size-[60px] items-center justify-center rounded-full bg-success-soft text-success" aria-hidden="true">
        <CheckIcon size={30} />
      </span>
      <h1 className="mt-5 text-[26px] font-semibold leading-[1.15] tracking-[-0.03em]">Pedido enviado para a cozinha</h1>
      <p className="mt-2.5 text-[15px] leading-normal text-ink-2">
        {receipt.table
          ? `É só aguardar na ${receipt.table.label}. A comida chega até você.`
          : "É só aguardar. Avise o garçom em qual mesa você está."}
      </p>

      <div className="mt-6 flex flex-col gap-2.5 rounded-card border border-paper-3 p-4">
        {receipt.items.map((item, index) => (
          <div key={index} className="flex gap-2 text-sm">
            <span className="tabular-nums text-ink-2">{item.quantity}×</span>
            <span className="min-w-0">{item.name}</span>
            <span className="ml-auto tabular-nums">{formatCents(item.unitPriceInCents * item.quantity)}</span>
          </div>
        ))}
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

      <div className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-[480px] border-t border-paper-3 bg-paper px-4 pb-[18px] pt-3">
        <button
          type="button"
          onClick={onRestart}
          className="min-h-[52px] w-full rounded-field bg-action text-base font-semibold text-white"
        >
          Voltar ao cardápio
        </button>
      </div>
    </main>
  );
}
