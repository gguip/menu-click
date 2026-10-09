import { Notifications } from "@mantine/notifications";

/**
 * Onde os avisos passageiros aparecem ("Alterações salvas", "Novo pedido").
 * No topo, porque a barra de salvar ocupa o rodapé. Sem transição: o painel
 * fica aberto o dia inteiro e nada nele anima.
 */
export function Toaster() {
  return <Notifications position="top-right" transitionDuration={0} limit={4} />;
}
