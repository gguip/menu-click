// apps/menu/src/components/checkout/PaymentStep.tsx
import { centsFromMoneyInput, formatMoneyInput } from "@/lib/checkout.ts";
import { type ChangeChoice, changeError, linkPayments, type Modality } from "@/lib/link-order.ts";
import { formatCents } from "@/lib/money.ts";
import type { PaymentMethod } from "@/lib/types.ts";
import { FIELD_BOX, FIELD_FOCUS, FIELD_TEXT } from "../field.ts";
import { ChoiceList } from "./ChoiceList.tsx";

const FIELD = `w-full px-3.5 py-3.5 ${FIELD_BOX} ${FIELD_FOCUS} ${FIELD_TEXT}`;

/** "Como você paga?", o troco no dinheiro e o resumo com a entrega. */
export function PaymentStep({
  modality,
  accepted,
  payment,
  change,
  changeText,
  itemsCents,
  feeLabel,
  totalCents,
  onPayment,
  onChange,
}: {
  modality: Modality;
  accepted: PaymentMethod[];
  payment: PaymentMethod | null;
  change: ChangeChoice;
  changeText: string;
  itemsCents: number;
  /** "R$ 9,00", "Grátis" ou "A combinar"; `null` fora da entrega. */
  feeLabel: string | null;
  totalCents: number;
  onPayment: (method: PaymentMethod) => void;
  onChange: (change: ChangeChoice, text: string) => void;
}) {
  const problem = payment === "cash" ? changeError(totalCents, change) : null;
  return (
    <>
      <section className="px-4 py-5">
        <h2 className="text-[19px] font-semibold tracking-[-0.02em]">Como você paga?</h2>
        <ChoiceList
          label="Forma de pagamento"
          name="pagamento"
          options={linkPayments(accepted, modality).map((p) => ({ value: p.method, label: p.label }))}
          value={payment}
          onChange={onPayment}
        />
        {payment === "cash" && (
          <div className="mt-4 flex flex-col gap-2.5">
            {!change.exact && (
              <label className="flex flex-col gap-1.5">
                <span className="text-[13px] font-semibold text-ink-2">Troco para quanto?</span>
                <input
                  inputMode="numeric"
                  placeholder="R$ 0,00"
                  value={changeText}
                  onChange={(e) => {
                    const text = formatMoneyInput(e.currentTarget.value);
                    onChange({ exact: false, cents: centsFromMoneyInput(text) }, text);
                  }}
                  className={FIELD}
                />
              </label>
            )}
            <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-[15px]">
              <input
                type="checkbox"
                className="size-5 accent-[var(--brand-action)]"
                checked={change.exact}
                onChange={(e) => onChange({ exact: e.currentTarget.checked, cents: null }, "")}
              />
              Não preciso de troco, tenho o valor exato
            </label>
            {problem && change.cents !== null && (
              <p role="alert" className="text-sm text-danger">
                {problem}
              </p>
            )}
          </div>
        )}
        <p className="mt-3 rounded-field bg-paper-2 px-3.5 py-3 text-[13px] leading-[1.45] text-ink-2">
          A loja cobra na entrega ou na retirada.
        </p>
      </section>

      <section className="border-t border-paper-3 px-4 py-5">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.1em] text-ink-3">Resumo</h2>
        <dl className="mt-2.5 flex flex-col gap-2 text-sm">
          <div className="flex">
            <dt className="text-ink-2">Itens</dt>
            <dd className="ml-auto font-medium tabular-nums">{formatCents(itemsCents)}</dd>
          </div>
          {feeLabel !== null && (
            <div className="flex">
              <dt className="text-ink-2">Entrega</dt>
              <dd className="ml-auto font-medium tabular-nums">{feeLabel}</dd>
            </div>
          )}
          <div className="flex border-t border-paper-3 pt-2.5">
            <dt className="text-sm font-semibold">TOTAL</dt>
            <dd className="ml-auto text-lg font-semibold tabular-nums">{formatCents(totalCents)}</dd>
          </div>
        </dl>
      </section>
    </>
  );
}
