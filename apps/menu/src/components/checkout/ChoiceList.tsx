// apps/menu/src/components/checkout/ChoiceList.tsx
/**
 * Escolha única em lista, o mesmo desenho do pagamento do salão: rádio
 * visualmente escondido (o rótulo inteiro é o alvo de toque) e a bolinha
 * desenhada ao lado.
 */
export function ChoiceList<T extends string>({
  label,
  name,
  options,
  value,
  onChange,
}: {
  label: string;
  name: string;
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="mt-3 overflow-hidden rounded-card border border-paper-3">
      {options.map((option) => {
        const on = value === option.value;
        return (
          <label
            key={option.value}
            className={`flex min-h-[52px] cursor-pointer items-center gap-3 border-b border-paper-3 px-4 last:border-b-0 ${on ? "bg-action/5" : ""}`}
          >
            <input type="radio" name={name} className="peer sr-only" checked={on} onChange={() => onChange(option.value)} />
            <span
              aria-hidden="true"
              className={`size-5 flex-none rounded-full peer-focus-visible:ring-2 peer-focus-visible:ring-action peer-focus-visible:ring-offset-2 ${
                on ? "border-[6px] border-action" : "border-[1.5px] border-line-control"
              }`}
            />
            <span className={`text-[15px] ${on ? "font-semibold" : ""}`}>{option.label}</span>
          </label>
        );
      })}
    </div>
  );
}
