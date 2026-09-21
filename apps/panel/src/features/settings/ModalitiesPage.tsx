import { Switch } from "@mantine/core";
import { useState } from "react";
import { describeError } from "../../api/client.ts";
import type { RestaurantPatch } from "../../api/restaurant.ts";
import type { Restaurant } from "../../api/types.ts";
import { useSessionUser } from "../../auth/useMe.ts";
import { Notice } from "../../ui/Notice.tsx";
import { useDeliveryAlert } from "../orders/useOrders.ts";
import { useRestaurant, useToggleRestaurantFlag } from "../restaurant/useRestaurant.ts";
import classes from "./ModalitiesPage.module.css";

type FlagField = keyof Pick<
  Restaurant,
  | "isDelivery"
  | "isTakeaway"
  | "isQrcode"
  | "acceptsPix"
  | "acceptsCardOnDelivery"
  | "acceptsCash"
  | "acceptsMealVoucher"
>;

type Flag = { field: FlagField; label: string; help: string };

const MODALITIES: readonly Flag[] = [
  { field: "isDelivery", label: "Entrega", help: "Frete e área atendida ficam na tela de Entrega" },
  { field: "isTakeaway", label: "Retirada no balcão", help: "O cliente busca no endereço da loja" },
  { field: "isQrcode", label: "Salão", help: "Pedido pela mesa, com QR code" },
];

const PAYMENTS: readonly Flag[] = [
  { field: "acceptsPix", label: "Pix", help: "Pago antes da confirmação" },
  { field: "acceptsCardOnDelivery", label: "Cartão", help: "Na entrega ou no caixa" },
  { field: "acceptsCash", label: "Dinheiro", help: "Habilita o campo de troco no pedido" },
  // Não está no handoff (que desenhou três formas), mas a API tem a flag e sem
  // o interruptor a loja não teria como ligá-la em lugar nenhum.
  {
    field: "acceptsMealVoucher",
    label: "Vale-refeição",
    help: "Exige credenciamento com a bandeira — ligue só se a loja já aceita",
  },
];

export function ModalitiesPage() {
  const { restaurantId } = useSessionUser();
  const restaurant = useRestaurant(restaurantId);
  const toggle = useToggleRestaurantFlag(restaurantId);
  const [failed, setFailed] = useState<FlagField | null>(null);
  const deliveryAlert = useDeliveryAlert(restaurantId, restaurant.data);

  const data = restaurant.data;
  if (data === undefined) return null;

  const change = (field: FlagField, checked: boolean) => {
    setFailed(null);
    const patch = { [field]: checked } as RestaurantPatch;
    toggle.mutate(patch, { onError: () => setFailed(field) });
  };

  const noModality = !data.isDelivery && !data.isTakeaway && !data.isQrcode;

  const renderFlag = (flag: Flag) => (
    <div key={flag.field} className={classes.row}>
      <Switch
        label={flag.label}
        description={flag.help}
        aria-label={flag.label}
        checked={data[flag.field]}
        onChange={(event) => change(flag.field, event.currentTarget.checked)}
      />
      {failed === flag.field && toggle.error !== null && (
        <p role="alert" className={classes.error}>
          {describeError(toggle.error)}
        </p>
      )}
    </div>
  );

  return (
    <div className={classes.page}>
      <section className={classes.card}>
        <h2 className={classes.cardTitle}>Modalidades</h2>
        {MODALITIES.map(renderFlag)}
      </section>

      {noModality && (
        <Notice tone="warn">
          Sem nenhuma modalidade ligada a loja não recebe pedido nenhum, mesmo dentro do horário. Ao
          menos uma precisa ficar ativa.
        </Notice>
      )}

      {data.isDelivery && deliveryAlert && (
        <Notice tone="warn" title="Entrega ligada, mas o frete não está configurado">
          O modo é por bairro e nenhum bairro está cadastrado: a loja recusa todo pedido de entrega até
          a tela de Entrega ser preenchida.
        </Notice>
      )}

      <section className={classes.card}>
        <h2 className={classes.cardTitle}>Pagamento</h2>
        {PAYMENTS.map(renderFlag)}
      </section>
    </div>
  );
}
