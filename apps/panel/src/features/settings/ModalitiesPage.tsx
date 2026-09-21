import { Button, Switch } from "@mantine/core";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { describeError } from "../../api/client.ts";
import type { RestaurantPatch } from "../../api/restaurant.ts";
import type { Restaurant } from "../../api/types.ts";
import { useSessionUser } from "../../auth/useMe.ts";
import { Notice } from "../../ui/Notice.tsx";
import { DeliveryAlert } from "../orders/OrdersNotices.tsx";
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

type Flag = { field: FlagField; label: string; help: ReactNode };

const MODALITIES: readonly Flag[] = [
  {
    field: "isDelivery",
    label: "Entrega",
    help: (
      <>
        Frete e área atendida ficam na tela de <Link to="/entrega">Entrega</Link>
      </>
    ),
  },
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

/**
 * Uma mutação PRÓPRIA por linha, e não uma dividida entre as sete. Um
 * `MutationObserver` do TanStack Query desanexa da mutação anterior assim
 * que `.mutate()` é chamado de novo nele (`MutationObserver#mutate`, em
 * `@tanstack/query-core`) — com um observer só para os sete interruptores,
 * ligar A e, antes de resolver, ligar B fazia o observer largar a mutação de
 * A no meio, e o `onError`/`onSuccess` daquela chamada nunca disparava (nem
 * errado: NUNCA). Não era um problema de "de onde a mensagem é lida" — era
 * de sete interruptores dividindo um observer só. Com uma mutação por linha,
 * `toggle.error` já é o erro DAQUELE interruptor, e uma chamada nova dele
 * mesmo limpa o próprio erro sozinha — sem estado local, sem coordenar nada.
 */
function FlagRow({ restaurantId, flag, checked }: { restaurantId: string; flag: Flag; checked: boolean }) {
  const toggle = useToggleRestaurantFlag(restaurantId);
  return (
    <div className={classes.row}>
      <Switch
        label={flag.label}
        description={flag.help}
        aria-label={flag.label}
        checked={checked}
        onChange={(event) =>
          toggle.mutate({ [flag.field]: event.currentTarget.checked } as RestaurantPatch)
        }
      />
      {toggle.error !== null && (
        <p role="alert" className={classes.error}>
          {describeError(toggle.error)}
        </p>
      )}
    </div>
  );
}

export function ModalitiesPage() {
  const { restaurantId } = useSessionUser();
  const restaurant = useRestaurant(restaurantId);
  const deliveryAlert = useDeliveryAlert(restaurantId, restaurant.data);

  const data = restaurant.data;
  // Carregando/erro só quando não há dado: sem isso, um 4xx deixava a tela em
  // branco para sempre (`return null`), e um refetch que falha trocaria os
  // interruptores pela mensagem mesmo com o dado antigo em mãos.
  if (data === undefined) {
    return (
      <p className={classes.loading}>
        {restaurant.isError ? describeError(restaurant.error) : "Carregando modalidades…"}
      </p>
    );
  }

  const noModality = !data.isDelivery && !data.isTakeaway && !data.isQrcode;
  // A parte 1 cria a loja com Entrega desligada e taxa fixa R$ 0 de propósito
  // (entregar de graça seria um acidente). Ligar Entrega aqui, sem tocar no
  // frete, reabre exatamente isso em silêncio.
  const freeDelivery =
    data.isDelivery && data.deliveryFeeMode === "fixed" && data.deliveryFixedFeeInCents === 0;

  const renderFlag = (flag: Flag) => (
    <FlagRow key={flag.field} restaurantId={restaurantId} flag={flag} checked={data[flag.field]} />
  );

  return (
    <div className={classes.page}>
      <p className={classes.note}>
        O que a loja aceita. Desligar uma modalidade tira a opção do cardápio público na hora — pedidos
        já abertos não são afetados.
      </p>

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

      {data.isDelivery && deliveryAlert && <DeliveryAlert />}

      {freeDelivery && (
        <Notice tone="warn" title="Entrega ligada com frete grátis">
          <div className={classes.noticeRow}>
            <span>
              A taxa fixa está em R$ 0,00: todo pedido de entrega sai sem frete. Se não é essa a
              intenção, desligue a Entrega até o frete ser configurado.
            </span>
            <Button component={Link} to="/entrega" variant="default">
              Configurar entrega
            </Button>
          </div>
        </Notice>
      )}

      <section className={classes.card}>
        <h2 className={classes.cardTitle}>Pagamento</h2>
        {PAYMENTS.map(renderFlag)}
      </section>
    </div>
  );
}
