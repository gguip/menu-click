import { closedHeadline, weekRows } from "@/lib/schedule.ts";
import type { MenuRestaurant } from "@/lib/types.ts";

/**
 * Os avisos que ficam acima do cardápio, na ordem em que importam: a mesa que
 * não resolveu (discreto — o cardápio funciona), a loja pausada (sem prometer
 * hora) e a loja fora do horário (com a grade: é a saída, não o aviso).
 */
export function StoreNotice({
  restaurant,
  tableUnknown,
  dineInOff = false,
  linkOff = false,
  now,
}: {
  restaurant: MenuRestaurant;
  tableUnknown: boolean;
  /** Na mesa, com o salão desligado pela loja (`isQrcode`). */
  dineInOff?: boolean;
  /** Pelo link, com a entrega e a retirada desligadas pela loja. */
  linkOff?: boolean;
  now: number | null;
}) {
  const paused = !restaurant.acceptingOrders;
  const closed = !paused && !restaurant.isOpen;

  return (
    <>
      {tableUnknown && (
        <p role="status" className="mx-4 mt-3 rounded-field bg-warn-soft px-3.5 py-2.5 text-[13px] text-warn">
          Não reconhecemos esta mesa. Você pode pedir normalmente — a loja vai confirmar sua mesa.
        </p>
      )}

      {dineInOff && !paused && (
        <p role="status" className="mx-4 mt-3 rounded-field bg-warn-soft px-3.5 py-2.5 text-[13px] text-warn">
          Esta loja não está recebendo pedidos pela mesa agora. Chame o garçom.
        </p>
      )}

      {linkOff && !paused && (
        <p role="status" className="mx-4 mt-3 rounded-field bg-warn-soft px-3.5 py-2.5 text-[13px] text-warn">
          Esta loja não está recebendo pedidos pelo app agora.
        </p>
      )}

      {paused && (
        <section className="mx-4 mt-3 rounded-card bg-warn-soft px-4 py-3.5 text-warn">
          <h2 className="text-[15px] font-semibold">A loja não está aceitando pedidos no momento</h2>
          <p className="mt-1 text-[13px]">Pode ser uma pausa curta. Vale tentar de novo em alguns minutos.</p>
        </section>
      )}

      {closed && (
        <section className="mx-4 mt-3 rounded-card border border-line bg-paper-2 px-4 py-3.5">
          <h2 className="text-[15px] font-semibold">{closedHeadline(restaurant, now)}</h2>
          <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-[13px]">
            {weekRows(restaurant.openingHours).map((row) => (
              <div key={row.days} className="contents">
                <dt className="text-ink-2">{row.days}</dt>
                <dd className="text-right tabular-nums">{row.hours}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2.5 text-[13px] text-ink-2">O cardápio continua visível abaixo — só não dá para pedir.</p>
        </section>
      )}
    </>
  );
}
