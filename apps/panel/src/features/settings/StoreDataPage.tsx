import { NativeSelect, TextInput } from "@mantine/core";
import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { describeError } from "../../api/client.ts";
import type { RestaurantPatch } from "../../api/restaurant.ts";
import type { Restaurant } from "../../api/types.ts";
import { useSessionUser } from "../../auth/useMe.ts";
import { notifySaved } from "../../lib/notify.tsx";
import { describeSaveError, type ImageChange, KEEP, uploadImage } from "../../lib/upload.ts";
import { ImageField } from "../../ui/ImageField.tsx";
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
  const [logo, setLogo] = useState<ImageChange>(KEEP);
  const [cover, setCover] = useState<ImageChange>(KEEP);
  // Trava contra o segundo clique. É um `ref`, e não o `isPending` da mutação:
  // o estado da mutação só chega à tela no redesenho seguinte, então dois
  // cliques no mesmo instante enxergariam `isPending: false` — há teste.
  const saving = useRef(false);

  // O salvar tem dois tempos: as imagens sobem ANTES do PATCH, e é a URL que
  // o Cloudinary devolve que vai nele. Envio que falha interrompe aqui, sem
  // gravar nada. Se o envio der certo e o PATCH falhar, o arquivo novo já
  // está lá, mas o cardápio segue na versão antiga — o banco guarda a URL com
  // versão — e salvar de novo conserta.
  const save = useMutation({
    mutationFn: async (textPatch: RestaurantPatch) => {
      const patch: RestaurantPatch = { ...textPatch };
      if (logo.kind === "replace") patch.logoUrl = await uploadImage(restaurant.id, logo.file, "logo");
      if (logo.kind === "remove") patch.logoUrl = null;
      if (cover.kind === "replace") patch.coverUrl = await uploadImage(restaurant.id, cover.file, "cover");
      if (cover.kind === "remove") patch.coverUrl = null;
      return update.mutateAsync(patch);
    },
    onSuccess: () => {
      notifySaved();
      setLogo(KEEP);
      setCover(KEEP);
    },
    onSettled: () => {
      saving.current = false;
    },
  });

  const field = (name: keyof StoreForm) => ({
    value: form[name],
    onChange: (event: { currentTarget: { value: string } }) =>
      setForm((current) => ({ ...current, [name]: event.currentTarget.value })),
  });

  const patch = changedPatch(form, initial);
  const dirty = Object.keys(patch).length > 0 || logo.kind !== "keep" || cover.kind !== "keep";

  // A API aceita apelidos de fuso (`Brazil/East`) que a lista fechada não
  // cobre. Sem essa opção extra, o `<select>` mostraria "Brasília" enquanto o
  // estado guarda outro valor — a tela mentiria sobre o que está salvo.
  const timezoneOptions = TIMEZONES.some((zone) => zone.value === restaurant.timezone)
    ? TIMEZONES
    : [...TIMEZONES, { value: restaurant.timezone, label: `${restaurant.timezone} (atual)` }];

  const submit = () => {
    const found = validateStoreForm(form);
    setProblem(found);
    if (found !== null || !dirty || saving.current) return;
    saving.current = true;
    save.mutate(patch);
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
            <ImageField
              label="Logo"
              description="JPG, PNG ou WebP, até 5 MB. Aparece ao lado do nome da loja no cardápio."
              saved={restaurant.logoUrl}
              change={logo}
              onChange={setLogo}
            />
            <ImageField
              label="Capa do cardápio"
              description="A imagem do topo do cardápio que o cliente abre pelo QR code. Fica melhor na horizontal."
              saved={restaurant.coverUrl}
              change={cover}
              onChange={setCover}
              shape="wide"
            />
            <TextInput
              label="Cor da marca"
              placeholder="#1E5AE8"
              description="É a cor do botão principal no cardápio do cliente. Precisa de contraste com o texto branco — a loja recusa tons claros."
              {...field("brandColor")}
            />
            <div className={classes.brandPreview}>
              <span
                className={classes.brandButton}
                // hex fora de tokens.ts de propósito: é a cor DA LOJA, não do tema do painel
                style={{ background: /^#[0-9A-Fa-f]{6}$/.test(form.brandColor.trim()) ? form.brandColor.trim() : "#1E5AE8" }}
              >
                Adicionar ao carrinho
              </span>
            </div>
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

        {problem !== null && (
          <p role="alert" className={classes.error}>
            {problem}
          </p>
        )}
        {save.isError && (
          <p role="alert" className={classes.error}>
            {describeSaveError(save.error)}
          </p>
        )}

        {role === "owner" && <DangerZone restaurant={restaurant} />}
      </div>
      <SaveBar
        dirty={dirty}
        busy={save.isPending}
        saveLabel="Salvar dados"
        onSave={submit}
        cancel={{
          onClick: () => {
            setForm(initial);
            setProblem(null);
            setLogo(KEEP);
            setCover(KEEP);
            save.reset();
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
