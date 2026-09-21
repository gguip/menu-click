import { NativeSelect, TextInput } from "@mantine/core";
import { useState } from "react";
import { describeError } from "../../api/client.ts";
import type { Restaurant } from "../../api/types.ts";
import { useSessionUser } from "../../auth/useMe.ts";
import { SaveBar } from "../../ui/SaveBar.tsx";
import { useRestaurant, useUpdateRestaurant } from "../restaurant/useRestaurant.ts";
import { DangerZone } from "./DangerZone.tsx";
import classes from "./StoreDataPage.module.css";
import { changedPatch, fromRestaurant, type StoreForm, validateStoreForm } from "./storeForm.ts";
import { TIMEZONES } from "./timezones.ts";

function StoreDataEditor({ restaurant }: { restaurant: Restaurant }) {
  const { role } = useSessionUser();
  const initial = fromRestaurant(restaurant);
  const [form, setForm] = useState<StoreForm>(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const update = useUpdateRestaurant(restaurant.id);

  const field = (name: keyof StoreForm) => ({
    value: form[name],
    onChange: (event: { currentTarget: { value: string } }) =>
      setForm((current) => ({ ...current, [name]: event.currentTarget.value })),
  });

  const patch = changedPatch(form, initial);
  const dirty = Object.keys(patch).length > 0;

  // A API aceita apelidos de fuso (`Brazil/East`) que a lista fechada não
  // cobre. Sem essa opção extra, o `<select>` mostraria "Brasília" enquanto o
  // estado guarda outro valor — a tela mentiria sobre o que está salvo.
  const timezoneOptions = TIMEZONES.some((zone) => zone.value === restaurant.timezone)
    ? TIMEZONES
    : [...TIMEZONES, { value: restaurant.timezone, label: `${restaurant.timezone} (atual)` }];

  const submit = () => {
    const found = validateStoreForm(form);
    setProblem(found);
    if (found !== null || !dirty) return;
    update.mutate(patch);
  };

  return (
    <>
      <div className={classes.page}>
        <div className={classes.columns}>
          <section className={classes.card}>
            <h2 className={classes.cardTitle}>Identificação</h2>
            <TextInput label="Nome da loja" {...field("name")} />
            <div className={classes.pair}>
              <TextInput label="Tipo de cozinha" {...field("cuisineType")} />
              <NativeSelect
                label="Fuso horário"
                description="É ele que decide onde o dia começa: “pedidos de hoje” e o faturamento do topo mudam junto."
                data={timezoneOptions.map((zone) => ({ value: zone.value, label: zone.label }))}
                {...field("timezone")}
              />
            </div>
            <TextInput
              label="URL do logo"
              placeholder="https://"
              description="Ainda não há upload de imagem: cole o endereço de uma imagem já publicada."
              {...field("logoUrl")}
            />
            <TextInput
              label="Endereço público"
              disabled
              value={`/${restaurant.slug}`}
              description="É a URL dentro do QR code impresso — por isso não muda por aqui."
            />
          </section>

          <section className={classes.card}>
            <h2 className={classes.cardTitle}>Endereço</h2>
            <TextInput label="Rua" {...field("street")} />
            <div className={classes.pair}>
              <TextInput label="Número" {...field("number")} />
              <TextInput label="Bairro" {...field("neighborhood")} />
            </div>
            <div className={classes.address}>
              <TextInput label="Cidade" {...field("city")} />
              <TextInput label="UF" maxLength={2} {...field("state")} />
              <TextInput label="CEP" {...field("zipCode")} />
            </div>
          </section>
        </div>

        {role === "owner" && <DangerZone restaurant={restaurant} />}

        {problem !== null && (
          <p role="alert" className={classes.error}>
            {problem}
          </p>
        )}
        {update.isError && (
          <p role="alert" className={classes.error}>
            {describeError(update.error)}
          </p>
        )}
      </div>
      <SaveBar
        dirty={dirty}
        busy={update.isPending}
        saveLabel="Salvar dados"
        onSave={submit}
        cancel={{
          onClick: () => {
            setForm(initial);
            setProblem(null);
          },
        }}
      />
    </>
  );
}

export function StoreDataPage() {
  const { restaurantId } = useSessionUser();
  const restaurant = useRestaurant(restaurantId);

  // Carregando/erro só quando não há dado: um refetch (poll da casca) que
  // falha mantém `data` antigo e `isError: true` ao mesmo tempo — checar
  // `isError` antes trocaria o editor pela mensagem de erro e derrubaria o
  // que a pessoa estava digitando.
  if (restaurant.data === undefined) {
    return (
      <p className={classes.loading}>
        {restaurant.isError ? describeError(restaurant.error) : "Carregando dados da loja…"}
      </p>
    );
  }
  // `key`: trocar de restaurante remonta o editor com os dados novos, sem
  // setState em efeito.
  return <StoreDataEditor key={restaurant.data.id} restaurant={restaurant.data} />;
}
