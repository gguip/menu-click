import { Button } from "@mantine/core";
import { describeError } from "../../api/client.ts";
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

/**
 * Falha de verdade na lista (429, 500, 403 — qualquer coisa que NÃO seja
 * `NetworkError`, que tem o próprio aviso em `OfflineNotice`). Substitui o
 * kanban por inteiro: sem isso, `showEmpty` exigia só `!isPending`, e uma
 * requisição que falhava no primeiro carregamento (sem dado nenhum) renderizava
 * "Nenhum pedido ainda hoje" — uma mentira no pior momento (FIX 1 da revisão).
 */
export function OrdersLoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div className={classes.notice}>
      <Notice tone="danger" title="Não foi possível carregar os pedidos">
        <div className={classes.noticeRow}>
          <span>{describeError(error)}</span>
          <Button variant="default" onClick={onRetry}>
            Tentar de novo
          </Button>
        </div>
      </Notice>
    </div>
  );
}

/**
 * O teto de páginas (1000 pedidos, 10 páginas de 100) foi atingido com
 * pedido ainda restando: a lista parou antes do fim. Silenciar isso era o
 * mesmo defeito que a paginação completa existe para evitar, só que na outra
 * ponta (FIX 2 da revisão).
 */
export function TruncatedOrdersNotice() {
  return (
    <div className={classes.notice}>
      <Notice tone="warn" title="Mostrando só os 1000 pedidos mais recentes do período">
        Há mais pedidos do que isso no recorte escolhido. Estreite o período, o intervalo de datas ou o
        filtro de mesa para ver os demais.
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
