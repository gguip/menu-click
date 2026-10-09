// apps/panel/src/features/settings/TimesCard.tsx
import { TextInput } from "@mantine/core";
import { useState } from "react";
import { describeError } from "../../api/client.ts";
import type { Restaurant } from "../../api/types.ts";
import { notifySaved } from "../../lib/notify.ts";
import { SaveBar } from "../../ui/SaveBar.tsx";
import { useUpdateRestaurant } from "../restaurant/useRestaurant.ts";
import classes from "./ModalitiesPage.module.css";
import { timesFromRestaurant, timesPatch, validateTimes } from "./times.ts";

/**
 * Os tempos que viram a previsão do acompanhamento. Formulário com barra de
 * salvar própria — os interruptores acima continuam salvando sozinhos, mas um
 * número pela metade ("4" de "45") não pode virar previsão enquanto se digita.
 * Montado com `key` nos próprios tempos: salvar recomeça do salvo.
 */
export function TimesCard({ restaurant }: { restaurant: Restaurant }) {
  const initial = timesFromRestaurant(restaurant);
  const [form, setForm] = useState(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const update = useUpdateRestaurant(restaurant.id);
  const patch = timesPatch(form, initial);
  const dirty = Object.keys(patch).length > 0;

  const field = (name: keyof typeof form) => ({
    value: form[name],
    inputMode: "numeric" as const,
    onChange: (event: { currentTarget: { value: string } }) => {
      // lido já: o atualizador do estado roda depois, com o evento reciclado
      const value = event.currentTarget.value;
      setForm((current) => ({ ...current, [name]: value }));
    },
  });

  const submit = () => {
    const found = validateTimes(form);
    setProblem(found);
    if (found !== null || !dirty) return;
    // pela promessa, e não por `onSuccess` da chamada: o card é remontado
    // quando os tempos salvos mudam, e callback por chamada morre com ele
    update.mutateAsync(patch).then(notifySaved, () => {});
  };

  return (
    <section className={classes.card}>
      <h2 className={classes.cardTitle}>Tempos estimados</h2>
      <p className={classes.note}>
        Viram a previsão que o cliente vê ao acompanhar o pedido, contada a partir de quando a loja aceita. Vazio = sem
        previsão.
      </p>
      <TextInput label="Preparo para retirada (min)" {...field("prep")} />
      <TextInput label="Entrega a partir de (min)" {...field("min")} />
      <TextInput label="Entrega até (min)" {...field("max")} />
      {(problem ?? (update.isError ? describeError(update.error) : null)) && (
        <p role="alert" className={classes.error}>
          {problem ?? describeError(update.error)}
        </p>
      )}
      <SaveBar
        dirty={dirty}
        busy={update.isPending}
        saveLabel="Salvar tempos"
        onSave={submit}
        cancel={{ onClick: () => setForm(initial) }}
      />
    </section>
  );
}
