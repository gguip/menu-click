import { bump, type CartLine, optionsText, subtotal } from "@/lib/cart.ts";
import { imageUrl } from "@/lib/image.ts";
import { formatCents } from "@/lib/money.ts";
import { MinusIcon, PlusIcon } from "./icons.tsx";
import { ScreenHeader } from "./ScreenHeader.tsx";

/**
 * O carrinho do salão: sem pedido mínimo (a regra vale só na entrega). Linhas
 * com as mesmas opções e a mesma observação já chegam juntas (`addLine`).
 */
export function CartScreen({
  lines,
  context,
  photos = {},
  notice = null,
  totalLabel = "Total",
  hint = null,
  onChange,
  onBack,
  onCheckout,
}: {
  lines: CartLine[];
  /** "Mesa 7" no salão. */
  context: string;
  /**
   * A foto de cada produto, pelo id, vinda do cardápio de agora — o carrinho
   * guardado não carrega URL, então foto trocada pela loja aparece certa.
   */
  photos?: Record<string, string>;
  /** O carrinho guardado mudou ao ser conferido com o cardápio. */
  notice?: string | null;
  /** "Total" no salão (sem frete); "Itens" no link (o frete vem no finalizar). */
  totalLabel?: "Total" | "Itens";
  /** O aviso de pedido mínimo da entrega; não trava o botão. */
  hint?: string | null;
  onChange: (next: CartLine[]) => void;
  onBack: () => void;
  onCheckout: () => void;
}) {
  if (lines.length === 0) {
    return (
      <main>
        <ScreenHeader title="Seu carrinho" context={context} onBack={onBack} />
        {notice && (
          <p role="status" className="mx-4 mt-3 rounded-field bg-warn-soft px-3.5 py-2.5 text-[13px] text-warn">
            {notice}
          </p>
        )}
        <div className="flex flex-col items-center gap-3.5 px-8 py-20 text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-paper-2 text-ink-3" aria-hidden="true">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
              <path d="M4 6h16l-1.5 11H5.5L4 6z" />
              <path d="M9 10v4M15 10v4" />
            </svg>
          </span>
          <h2 className="text-[17px] font-semibold">Carrinho vazio</h2>
          <p className="text-sm leading-normal text-ink-2">Volte ao cardápio e escolha o primeiro item.</p>
          <button
            type="button"
            onClick={onBack}
            className="mt-1 min-h-11 rounded-field border border-action px-[22px] text-[15px] font-semibold text-action"
          >
            Ver cardápio
          </button>
        </div>
      </main>
    );
  }

  // Loja sem foto nos itens do carrinho fica sem a coluna inteira: uma fileira
  // de quadrados vazios seria pior que a lista de antes.
  const showPhotos = lines.some((line) => photos[line.productId] !== undefined);

  return (
    <main className="pb-32">
      <ScreenHeader title="Seu carrinho" context={context} onBack={onBack} />
      {notice && (
        <p role="status" className="mx-4 mt-3 rounded-field bg-warn-soft px-3.5 py-2.5 text-[13px] text-warn">
          {notice}
        </p>
      )}
      <ul>
        {lines.map((line) => (
          <li key={line.key} className="flex gap-3 border-b border-paper-3 p-4">
            {showPhotos && (
              // a linha sem foto guarda o lugar, para o texto alinhar com as outras
              <div data-slot="photo" className="size-16 flex-none overflow-hidden rounded-lg bg-paper-3">
                {photos[line.productId] !== undefined && (
                  // largura da grade (400): já está no cache e não cria transformação nova
                  <img
                    src={imageUrl(photos[line.productId], 400)}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                )}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex gap-2.5">
                <span className="min-w-0 text-[15px] font-semibold tracking-[-0.01em]">{line.name}</span>
                <span className="ml-auto flex-none text-[15px] font-semibold tabular-nums">
                  {formatCents(line.unitPriceInCents * line.quantity)}
                </span>
              </div>
              <p className="mt-1 text-xs leading-[1.4] text-ink-2">{optionsText(line)}</p>
              {line.note && (
                <p className="mt-0.5 text-xs leading-[1.4] text-ink-2">
                  <span className="font-semibold">Obs.: </span>
                  <span>{line.note}</span>
                </p>
              )}
              <div className="mt-2.5 flex w-fit items-center gap-1 rounded-lg border border-line-strong p-0.5">
                <button
                  type="button"
                  aria-label={`Diminuir ${line.name}`}
                  onClick={() => onChange(bump(lines, line.key, -1))}
                  className="flex size-11 items-center justify-center rounded-md text-ink-2 hover:bg-paper-2"
                >
                  <MinusIcon size={16} />
                </button>
                <span className="min-w-[22px] text-center text-[15px] font-semibold tabular-nums">{line.quantity}</span>
                <button
                  type="button"
                  aria-label={`Aumentar ${line.name}`}
                  onClick={() => onChange(bump(lines, line.key, 1))}
                  className="flex size-11 items-center justify-center rounded-md text-ink-2 hover:bg-paper-2"
                >
                  <PlusIcon size={16} />
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <button type="button" onClick={onBack} className="min-h-11 px-4 pt-3 text-[15px] font-semibold text-action">
        + Adicionar mais itens
      </button>

      {/* No salão o valor já é o total; pelo link, o frete entra no finalizar,
          e aqui o valor é só dos itens. */}
      <dl className="mx-4 mt-4 flex border-t border-paper-3 pt-4 text-[15px]">
        <dt className="text-ink-2">{totalLabel}</dt>
        <dd className="ml-auto font-semibold tabular-nums">{formatCents(subtotal(lines))}</dd>
      </dl>
      {hint && <p className="mx-4 mt-2 text-[13px] text-warn">{hint}</p>}

      <div className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-[480px] border-t border-paper-3 bg-paper px-4 pb-[18px] pt-3">
        <button type="button" onClick={onCheckout} className="min-h-[52px] w-full rounded-field bg-action text-base font-semibold text-white">
          Finalizar pedido
        </button>
      </div>
    </main>
  );
}
