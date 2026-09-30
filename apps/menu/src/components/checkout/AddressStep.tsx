// apps/menu/src/components/checkout/AddressStep.tsx
import { formatZip } from "@/lib/checkout.ts";
import type { AddressForm } from "@/lib/link-order.ts";
import { type Quote, quoteText } from "@/lib/quote.ts";
import { FIELD_BOX, FIELD_FOCUS, FIELD_TEXT } from "../field.ts";

const FIELD = `w-full px-3.5 py-3.5 ${FIELD_BOX} ${FIELD_FOCUS} ${FIELD_TEXT}`;

/**
 * "Onde entregar?". No modo por bairro o bairro é uma lista (os nomes vêm do
 * cardápio público); nos outros, texto livre. Cidade e UF não aparecem: vêm
 * do endereço da loja, porque a entrega é local.
 */
export function AddressStep({
  address,
  neighborhoods,
  quote,
  error,
  canSwitchToTakeaway,
  onChange,
  onRetryQuote,
  onSwitchToTakeaway,
}: {
  address: AddressForm;
  /** Vazia fora do modo por bairro: aí o bairro é texto livre. */
  neighborhoods: string[];
  quote: Quote;
  /** O 409 "não entrega neste endereço" da criação, trazido de volta para cá. */
  error: string | null;
  canSwitchToTakeaway: boolean;
  onChange: (next: AddressForm) => void;
  onRetryQuote: () => void;
  onSwitchToTakeaway: () => void;
}) {
  const set = (field: keyof AddressForm, value: string) => onChange({ ...address, [field]: value });
  const text = quoteText(quote);

  return (
    <section className="flex flex-col gap-4 px-4 py-5">
      <h2 className="text-[19px] font-semibold tracking-[-0.02em]">Onde entregar?</h2>
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-semibold text-ink-2">Bairro</span>
        {neighborhoods.length > 0 ? (
          <select value={address.neighborhood} onChange={(e) => set("neighborhood", e.currentTarget.value)} className={FIELD}>
            <option value="">Selecione o bairro</option>
            {neighborhoods.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        ) : (
          <input value={address.neighborhood} onChange={(e) => set("neighborhood", e.currentTarget.value)} className={FIELD} />
        )}
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-semibold text-ink-2">Rua</span>
        <input autoComplete="address-line1" value={address.street} onChange={(e) => set("street", e.currentTarget.value)} className={FIELD} />
      </label>
      <div className="grid grid-cols-[1fr_1.4fr] gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold text-ink-2">Número</span>
          <input inputMode="numeric" placeholder="000" value={address.number} onChange={(e) => set("number", e.currentTarget.value)} className={FIELD} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold text-ink-2">CEP</span>
          <input
            inputMode="numeric"
            autoComplete="postal-code"
            placeholder="00000-000"
            value={address.zip}
            onChange={(e) => set("zip", formatZip(e.currentTarget.value))}
            className={FIELD}
          />
        </label>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-semibold text-ink-2">Complemento</span>
        <input
          placeholder="apto, bloco, referência"
          maxLength={120}
          autoComplete="address-line2"
          value={address.complement}
          onChange={(e) => set("complement", e.currentTarget.value)}
          className={FIELD}
        />
      </label>

      {error && (
        <p role="alert" className="rounded-field border border-danger/30 px-3.5 py-3 text-sm text-danger">
          {error}
        </p>
      )}
      {quote.kind === "loading" && <p className="text-sm text-ink-2">Calculando a entrega…</p>}
      {quote.kind === "error" && (
        <div role="alert" className="rounded-field bg-warn-soft px-3.5 py-3 text-sm text-warn">
          <p>Não deu para calcular a entrega.</p>
          <button type="button" onClick={onRetryQuote} className="mt-1 min-h-11 font-semibold underline">
            Tentar de novo
          </button>
        </div>
      )}
      {text && quote.kind !== "none" && (
        <p role="status" className="rounded-field bg-paper-2 px-3.5 py-3 text-sm font-semibold">
          {text}
        </p>
      )}
      {quote.kind === "none" && (
        <div role="alert" className="rounded-field bg-warn-soft px-3.5 py-3 text-sm text-warn">
          <p className="font-semibold">{text}</p>
          {canSwitchToTakeaway && (
            <button type="button" onClick={onSwitchToTakeaway} className="mt-1 min-h-11 font-semibold text-action">
              Trocar para retirada
            </button>
          )}
        </div>
      )}
    </section>
  );
}
