import { TimePicker } from "@mantine/dates";
import { useState } from "react";

/**
 * Campo de hora (`HH:mm`), com a lista de horas e minutos no visual do painel
 * — o `<input type="time">` deixa a lista por conta do navegador.
 *
 * O `TimePicker` roda SEM `value`: controlado, ele apaga a hora inteira assim
 * que os minutos ficam vazios, porque hora pela metade sobe como `""` e `""`
 * de volta manda limpar tudo. Aqui ele guarda o que está sendo digitado, e só
 * é remontado quando o valor muda por fora (descartar, recarregar a grade).
 *
 * Hora pela metade chega a `onChange` como `""`.
 */
export function TimeField({
  label,
  value,
  onChange,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const [sync, setSync] = useState({ mount: 0, known: value });
  if (value !== sync.known) setSync({ mount: sync.mount + 1, known: value });

  return (
    <TimePicker
      key={sync.mount}
      className={className}
      aria-label={label}
      hoursInputLabel={`${label}, hora`}
      minutesInputLabel={`${label}, minuto`}
      defaultValue={value}
      withDropdown
      minutesStep={5}
      onChange={(next) => {
        // o componente devolve `HH:mm:ss`; a grade é em `HH:mm`
        const time = next.slice(0, 5);
        setSync((current) => ({ ...current, known: time }));
        onChange(time);
      }}
    />
  );
}
