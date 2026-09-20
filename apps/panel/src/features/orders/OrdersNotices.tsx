import { Button } from "@mantine/core";
import { formatAge } from "../../lib/time.ts";
import { Notice } from "../../ui/Notice.tsx";
import classes from "./OrdersPage.module.css";

export function DeliveryAlert() {
  // O botão "Configurar entrega" do handoff entra com a tela de Entrega (parte 2).
  return (
    <div className={classes.notice}>
      <Notice tone="warn" title="Entrega por bairro sem nenhum bairro cadastrado">
        Não é frete grátis: a loja não consegue calcular o frete e vai recusar pedidos de entrega.
        Cadastre os bairros ou mude para taxa fixa.
      </Notice>
    </div>
  );
}

export function OfflineNotice({
  updatedAt,
  now,
  onRetry,
}: {
  updatedAt: number;
  now: number;
  onRetry: () => void;
}) {
  const age = updatedAt > 0 ? `A lista abaixo é de ${formatAge((now - updatedAt) / 1000)} atrás e pode estar desatualizada.` : "A lista ainda não carregou.";
  return (
    <div className={classes.notice}>
      <Notice tone="warn" title="Sem internet">
        <div className={classes.noticeRow}>
          <span>
            {age} Aceitar e despachar ficam bloqueados até a conexão voltar — assim nada é aceito duas
            vezes.
          </span>
          <Button variant="default" onClick={onRetry}>
            Tentar de novo
          </Button>
        </div>
      </Notice>
    </div>
  );
}

export function EmptyOrders() {
  return (
    <div className={classes.empty}>
      <p className={classes.emptyTitle}>Nenhum pedido ainda hoje</p>
      <p className={classes.emptyBody}>
        A tela se atualiza sozinha e avisa com som quando o primeiro chegar. Não é preciso recarregar.
      </p>
    </div>
  );
}
