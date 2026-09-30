import { formatCents } from "@/lib/money.ts";
import { openChip } from "@/lib/schedule.ts";
import type { MenuRestaurant } from "@/lib/types.ts";

const CHIP = "rounded-full border px-2.5 py-[5px] text-xs font-semibold";

/**
 * O topo da loja: capa, logo, nome, e os chips que mudam a decisão de compra.
 * "Pedido mínimo" e "Entrega grátis" só fora do salão — as duas regras valem
 * só na entrega, e mostrá-las na mesa seria prometer uma regra que não vale ali.
 */
export function MenuHeader({
  restaurant,
  inDineIn,
}: {
  restaurant: MenuRestaurant;
  inDineIn: boolean;
}) {
  const chip = openChip(restaurant);
  const chipTone =
    chip.tone === "open" ? "border-success/30 text-success" : "border-warn/30 bg-warn-soft text-warn";

  return (
    <header>
      <div className="relative h-[118px] bg-paper-3">
        {restaurant.coverUrl ? (
          <img src={restaurant.coverUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-[11px] uppercase tracking-[0.14em] text-ink-3">
            capa da loja
          </span>
        )}
      </div>

      <div className="flex items-center gap-3 px-4 pt-3.5">
        <div className="flex size-[52px] flex-none items-center justify-center overflow-hidden rounded-field border border-line bg-paper-2 text-[9px] text-ink-3">
          {restaurant.logoUrl ? (
            <img src={restaurant.logoUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            "LOGO"
          )}
        </div>
        <div className="min-w-0">
          <h1 className="text-[19px] font-semibold leading-tight tracking-[-0.02em]">{restaurant.name}</h1>
          <p className="mt-0.5 text-[13px] text-ink-2">{restaurant.cuisineType}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 px-4 pt-3">
        <span className={`${CHIP} ${chipTone}`}>{chip.text}</span>
        {!inDineIn && restaurant.minimumOrderInCents > 0 && (
          <span className={`${CHIP} border-action/30 text-action`}>
            Pedido mínimo {formatCents(restaurant.minimumOrderInCents)}
          </span>
        )}
        {!inDineIn && restaurant.freeDeliveryAboveInCents !== undefined && (
          <span className={`${CHIP} border-action/30 text-action`}>
            Entrega grátis acima de {formatCents(restaurant.freeDeliveryAboveInCents)}
          </span>
        )}
      </div>
    </header>
  );
}
