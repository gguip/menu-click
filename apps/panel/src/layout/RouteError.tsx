import { Button } from "@mantine/core";
import { Link } from "react-router";
import classes from "./RouteError.module.css";

/**
 * `errorElement` da rota do shell (`router.tsx`). Sem ele, um `throw` em
 * qualquer tela de dentro do painel — `columnOf` com status desconhecido
 * antes do FIX 6, `useSessionUser` fora de uma rota guardada, qualquer bug
 * de render — derrubava a árvore inteira e deixava uma tela em branco, sem
 * pista nenhuma de que algo quebrou. Não mostra detalhe do erro (o
 * equivalente, no front, do S11 da API): a mensagem é sempre a mesma,
 * genérica, com um jeito de sair do buraco.
 */
export function RouteError() {
  return (
    <div className={classes.page}>
      <div className={classes.card}>
        <h1 className={classes.title}>Algo deu errado</h1>
        <p className={classes.body}>
          Essa tela não carregou. Recarregar costuma resolver — se continuar acontecendo, volte para os
          pedidos e tente de novo a partir de lá.
        </p>
        <div className={classes.actions}>
          <Button onClick={() => window.location.reload()}>Recarregar</Button>
          <Button component={Link} to="/pedidos" variant="default">
            Ir para os pedidos
          </Button>
        </div>
      </div>
    </div>
  );
}
