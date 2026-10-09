import { Notifications } from "@mantine/notifications";
import classes from "./Toaster.module.css";

/**
 * Onde os avisos passageiros aparecem ("Alterações salvas", "Novo pedido").
 * No topo, logo abaixo do header, porque a barra de salvar ocupa o rodapé.
 * Sem transição: o painel fica aberto o dia inteiro e nada nele anima.
 */
export function Toaster() {
  return (
    <Notifications
      position="top-right"
      transitionDuration={0}
      limit={4}
      containerWidth={400}
      classNames={{ root: classes.root }}
    />
  );
}
