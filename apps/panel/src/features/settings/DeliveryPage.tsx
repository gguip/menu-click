import { Button, Switch, TextInput } from "@mantine/core";
import { useState } from "react";
import { describeError } from "../../api/client.ts";
import type { DeliveryNeighborhood, Restaurant } from "../../api/types.ts";
import { useSessionUser } from "../../auth/useMe.ts";
import { formatCents } from "../../lib/money.ts";
import buttons from "../../ui/buttons.module.css";
import { SaveBar } from "../../ui/SaveBar.tsx";
import { DeliveryAlert } from "../orders/OrdersNotices.tsx";
import { useDeliveryAlert } from "../orders/useOrders.ts";
import { useRestaurant, useUpdateRestaurant } from "../restaurant/useRestaurant.ts";
import {
  addNeighborhood,
  changedDeliveryPatch,
  DELIVERY_MODES,
  type DeliveryForm,
  fromRestaurant,
  isDeliveryDirty,
  neighborhoodCountLabel,
  neighborhoodsChanged,
  toArrangeHelp,
  validateDeliveryForm,
} from "./delivery.ts";
import classes from "./DeliveryPage.module.css";
import { useNeighborhoods, useSaveNeighborhoods } from "./useDelivery.ts";

/**
 * `restaurant` e `saved` são o CACHE, relidos a cada render: é contra eles
 * que a sujeira é medida. Por isso um PATCH que falha depois de um PUT que
 * deu certo deixa a barra suja só no que faltou, sem estado extra.
 */
function DeliveryEditor({
  restaurant,
  saved,
}: {
  restaurant: Restaurant;
  saved: readonly DeliveryNeighborhood[];
}) {
  const [form, setForm] = useState<DeliveryForm>(() => fromRestaurant(restaurant));
  const [list, setList] = useState<DeliveryNeighborhood[]>(() => [...saved]);
  const [newName, setNewName] = useState("");
  const [newFee, setNewFee] = useState("");
  const [addProblem, setAddProblem] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const saveList = useSaveNeighborhoods(restaurant.id);
  const update = useUpdateRestaurant(restaurant.id);
  // O aviso do topo lê o SALVO (`restaurant` e a query dos bairros), não o
  // formulário: ele diz o que o servidor está fazendo agora.
  const alert = useDeliveryAlert(restaurant.id, restaurant);

  const listChanged = neighborhoodsChanged(list, saved);
  const dirty = isDeliveryDirty(form, restaurant, listChanged);

  const set = <K extends keyof DeliveryForm>(key: K, value: DeliveryForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const add = () => {
    const result = addNeighborhood(list, newName, newFee);
    if ("error" in result) {
      setAddProblem(result.error);
      return;
    }
    setList(result.list);
    setNewName("");
    setNewFee("");
    setAddProblem(null);
  };

  const submit = async () => {
    const found = validateDeliveryForm(form);
    setProblem(found);
    if (found !== null) return;
    try {
      // Bairros ANTES do restaurante: trocar para "por bairro" antes de a
      // lista existir faria a loja recusar entrega por um instante.
      if (listChanged) await saveList.mutateAsync(list);
      const patch = changedDeliveryPatch(form, restaurant);
      if (Object.keys(patch).length > 0) await update.mutateAsync(patch);
    } catch {
      // A mensagem sai de `saveList.error`/`update.error`. O que deu certo já
      // está no cache, e a barra continua suja só no que faltou.
    }
  };

  const cancel = () => {
    setForm(fromRestaurant(restaurant));
    setList([...saved]);
    setNewName("");
    setNewFee("");
    setAddProblem(null);
    setProblem(null);
    saveList.reset();
    update.reset();
  };

  return (
    <>
      <div className={classes.page}>
        {alert && <DeliveryAlert withAction={false} />}

        <section className={classes.card}>
          <h2 className={classes.cardTitle}>Como o frete é calculado</h2>
          <div className={classes.modes} role="radiogroup" aria-label="Como o frete é calculado">
            {DELIVERY_MODES.map((mode) => {
              const selected = form.mode === mode.value;
              const className = [
                classes.mode,
                selected ? classes.selected : "",
                mode.disabled ? classes.disabledMode : "",
              ].join(" ");
              return (
                <label key={mode.value} className={className}>
                  <input
                    type="radio"
                    name="delivery-mode"
                    className={classes.radio}
                    aria-label={mode.label}
                    value={mode.value}
                    checked={selected}
                    disabled={mode.disabled}
                    onChange={() => set("mode", mode.value)}
                  />
                  <span className={classes.modeLabel}>{mode.label}</span>
                  <span className={classes.modeHelp}>{mode.help}</span>
                </label>
              );
            })}
          </div>
        </section>

        {form.mode === "neighborhood" && (
          <section className={classes.card}>
            <div className={classes.cardHead}>
              <h2 className={classes.cardTitle}>Bairros atendidos</h2>
              <span className={`${classes.count} n`}>{neighborhoodCountLabel(list.length)}</span>
            </div>
            {list.length === 0 ? (
              <div className={classes.empty}>
                <strong className={classes.emptyTitle}>Nenhum bairro cadastrado</strong>
                <p className={classes.emptyBody}>
                  Neste estado a loja não consegue calcular frete nenhum e recusa os pedidos de entrega.
                  Isto não é entrega grátis.
                </p>
              </div>
            ) : (
              <ul className={classes.list}>
                {list.map((item) => (
                  <li key={item.name} className={classes.row}>
                    <span className={classes.name}>{item.name}</span>
                    <span className={`${classes.fee} n`}>{formatCents(item.feeInCents)}</span>
                    <Button
                      variant="subtle"
                      className={buttons.dangerText}
                      aria-label={`Remover ${item.name}`}
                      onClick={() => setList(list.filter((other) => other !== item))}
                    >
                      Remover
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <div className={classes.addRow}>
              <TextInput
                aria-label="Novo bairro"
                placeholder="Bairro"
                value={newName}
                onChange={(event) => setNewName(event.currentTarget.value)}
              />
              <TextInput
                aria-label="Frete do novo bairro"
                placeholder="0,00"
                value={newFee}
                onChange={(event) => setNewFee(event.currentTarget.value)}
              />
              <Button variant="default" onClick={add}>
                Adicionar bairro
              </Button>
            </div>
            {addProblem !== null && (
              <p role="alert" className={classes.error}>
                {addProblem}
              </p>
            )}
          </section>
        )}

        {form.mode === "fixed" && (
          <section className={classes.card}>
            <TextInput
              label="Taxa fixa para toda a área atendida"
              className={classes.fixed}
              value={form.fixedFee}
              onChange={(event) => set("fixedFee", event.currentTarget.value)}
            />
          </section>
        )}

        <section className={classes.card}>
          <h2 className={classes.cardTitle}>Regras de valor</h2>
          <div className={classes.rules}>
            <TextInput
              label="Entrega grátis acima de"
              description="Compara com o valor dos itens, sem o frete. Uma sacola de R$ 115 + R$ 9 de frete não ganha a isenção."
              placeholder="Sem entrega grátis"
              value={form.freeAbove}
              onChange={(event) => set("freeAbove", event.currentTarget.value)}
            />
            <TextInput
              label="Pedido mínimo"
              description="Vale só para entrega. Zero significa sem mínimo — retirada e salão nunca são afetados."
              value={form.minimumOrder}
              onChange={(event) => set("minimumOrder", event.currentTarget.value)}
            />
          </div>
          <Switch
            label="Aceitar pedido com frete a combinar"
            aria-label="Aceitar pedido com frete a combinar"
            description={toArrangeHelp(form.toArrange)}
            checked={form.toArrange}
            onChange={(event) => set("toArrange", event.currentTarget.checked)}
          />
        </section>

        {problem !== null && (
          <p role="alert" className={classes.error}>
            {problem}
          </p>
        )}
        {saveList.isError && (
          <p role="alert" className={classes.error}>
            {describeError(saveList.error)}
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
        busy={saveList.isPending || update.isPending}
        saveLabel="Salvar entrega"
        onSave={() => void submit()}
        cancel={{ onClick: cancel }}
      />
    </>
  );
}

export function DeliveryPage() {
  const { restaurantId } = useSessionUser();
  const restaurant = useRestaurant(restaurantId);
  const neighborhoods = useNeighborhoods(restaurantId);

  // Carregando/erro só quando não há dado: um refetch que falha mantém o
  // `data` antigo, e trocar o formulário pela mensagem apagaria o que a
  // pessoa estava digitando.
  if (restaurant.data === undefined || neighborhoods.data === undefined) {
    const error = restaurant.error ?? neighborhoods.error;
    return <p className={classes.loading}>{error ? describeError(error) : "Carregando entrega…"}</p>;
  }
  return <DeliveryEditor restaurant={restaurant.data} saved={neighborhoods.data} />;
}
