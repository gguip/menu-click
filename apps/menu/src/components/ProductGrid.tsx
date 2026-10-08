import { imageUrl } from "@/lib/image.ts";
import { formatCents } from "@/lib/money.ts";
import { fromPrice } from "@/lib/selection.ts";
import type { MenuOptionGroup, MenuProduct, MenuSection } from "@/lib/types.ts";

/** Id de âncora da seção, para as abas rolarem até ela. */
export function sectionAnchor(index: number): string {
  return `secao-${index}`;
}

/**
 * A grade de dois cards por seção. Produto indisponível APARECE (apagado, não
 * abre): sumir com ele faria o cliente procurar um prato que sabe que existe.
 */
export function ProductGrid({
  sections,
  groups,
  onOpen,
}: {
  sections: MenuSection[];
  groups: MenuOptionGroup[];
  onOpen: (product: MenuProduct) => void;
}) {
  return (
    <>
      {sections.map((section, index) => (
        <section key={section.id ?? section.name} id={sectionAnchor(index)} aria-label={section.name} className="scroll-mt-14">
          <h2 className="px-4 pb-1.5 pt-[18px] text-[13px] font-semibold uppercase tracking-[0.1em] text-ink-3">
            {section.name}
          </h2>
          <div className="grid grid-cols-2 gap-3 px-4">
            {section.products.map((product) =>
              product.available ? (
                <AvailableCard key={product.id} product={product} groups={groups} onOpen={() => onOpen(product)} />
              ) : (
                <SoldOutCard key={product.id} product={product} />
              ),
            )}
          </div>
        </section>
      ))}
    </>
  );
}

function Photo({ product, dim = false }: { product: MenuProduct; dim?: boolean }) {
  return (
    <div className={`flex h-28 items-center justify-center bg-paper-3 text-[9px] text-ink-3 ${dim ? "opacity-40" : ""}`}>
      {product.photoUrl ? (
        <img src={imageUrl(product.photoUrl, 400)} alt="" loading="lazy" className="h-full w-full object-cover" />
      ) : (
        "FOTO"
      )}
    </div>
  );
}

function AvailableCard({
  product,
  groups,
  onOpen,
}: {
  product: MenuProduct;
  groups: MenuOptionGroup[];
  onOpen: () => void;
}) {
  const price = fromPrice(product, groups);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex flex-col overflow-hidden rounded-card border border-paper-3 text-left transition-colors hover:border-action/30"
    >
      <Photo product={product} />
      <span className="flex flex-1 flex-col gap-[3px] px-[11px] pb-3 pt-2.5">
        <span className="text-sm font-semibold tracking-[-0.01em]">{product.name}</span>
        {product.description && <span className="text-xs leading-[1.35] text-ink-2">{product.description}</span>}
        <span className="mt-auto pt-2">
          <span className="block min-h-3.5 text-[11px] text-ink-3">{price.prefix}</span>
          <span className="block text-[15px] font-semibold tabular-nums">{formatCents(price.cents)}</span>
        </span>
      </span>
    </button>
  );
}

function SoldOutCard({ product }: { product: MenuProduct }) {
  return (
    <div aria-disabled="true" className="flex flex-col overflow-hidden rounded-card border border-paper-3 bg-paper-soft">
      <Photo product={product} dim />
      <div className="flex flex-1 flex-col gap-1.5 px-[11px] pb-3 pt-2.5">
        <span className="text-sm font-semibold tracking-[-0.01em] text-ink-3">{product.name}</span>
        <span className="mt-auto self-start rounded-chip bg-paper-3 px-2 py-1 text-[11px] font-semibold text-ink-2">
          Indisponível hoje
        </span>
      </div>
    </div>
  );
}
