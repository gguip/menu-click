import { Button, TextInput } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { listAllCategories } from "../../api/categories.ts";
import { listProducts } from "../../api/products.ts";
import { useSessionUser } from "../../auth/useMe.ts";
import { formatCents } from "../../lib/money.ts";
import classes from "./ProductsPage.module.css";
import { stockText, stockTone } from "./stock.ts";

const PAGE_SIZE = 20;

function EmptyMenu() {
  return (
    <div className={classes.page}>
      <div className={classes.empty}>
        <p className={classes.emptyTitle}>Seu cardápio está vazio</p>
        <p className={classes.emptyBody}>
          Comece pelas seções — elas definem a ordem da refeição que o cliente vê. Depois cadastre os
          produtos dentro delas.
        </p>
        <Button component={Link} to="/secoes">
          Criar a primeira seção
        </Button>
      </div>
    </div>
  );
}

export function ProductsPage() {
  const { restaurantId } = useSessionUser();
  const [params, setParams] = useSearchParams();
  const search = params.get("search") ?? "";
  const categoryId = params.get("category") ?? "";
  const page = Math.max(1, Number(params.get("page")) || 1);

  const [typed, setTyped] = useState(search);
  const [debounced] = useDebouncedValue(typed, 300);

  // a busca digitada vai para a URL (e dali para a API) depois da pausa
  useEffect(() => {
    const next = debounced.trim();
    if (next === search) return;
    const updated = new URLSearchParams(params);
    if (next) updated.set("search", next);
    else updated.delete("search");
    updated.delete("page");
    setParams(updated, { replace: true });
  }, [debounced, search, params, setParams]);

  const setParam = (name: "category" | "page", value: string | null) => {
    const updated = new URLSearchParams(params);
    if (value) updated.set(name, value);
    else updated.delete(name);
    if (name !== "page") updated.delete("page");
    setParams(updated);
  };

  const categories = useQuery({
    queryKey: ["categories", restaurantId],
    queryFn: () => listAllCategories(restaurantId),
  });
  const offset = (page - 1) * PAGE_SIZE;
  const products = useQuery({
    queryKey: ["products", restaurantId, "list", { search, categoryId, page }],
    queryFn: () =>
      listProducts(restaurantId, {
        search: search || undefined,
        categoryId: categoryId || undefined,
        limit: PAGE_SIZE,
        offset,
      }),
    placeholderData: keepPreviousData,
  });

  const sectionName = new Map((categories.data ?? []).map((category) => [category.id, category.name]));
  const data = products.data;

  if (
    data !== undefined &&
    categories.data !== undefined &&
    data.total === 0 &&
    search === "" &&
    categoryId === "" &&
    categories.data.length === 0
  ) {
    return <EmptyMenu />;
  }

  const shownUpTo = data ? Math.min(offset + data.data.length, data.total) : 0;

  return (
    <div className={classes.page}>
      <div className={classes.toolbar}>
        <TextInput
          className={classes.search}
          aria-label="Buscar por nome"
          placeholder="Buscar por nome"
          value={typed}
          onChange={(event) => setTyped(event.currentTarget.value)}
        />
        <div className={classes.chips} role="group" aria-label="Seção">
          <button
            type="button"
            className={classes.chip}
            aria-pressed={categoryId === ""}
            onClick={() => setParam("category", null)}
          >
            Todas
          </button>
          {(categories.data ?? []).map((category) => (
            <button
              key={category.id}
              type="button"
              className={classes.chip}
              aria-pressed={categoryId === category.id}
              onClick={() => setParam("category", category.id)}
            >
              {category.name}
            </button>
          ))}
        </div>
        <Button component={Link} to="/produtos/novo" className={classes.new}>
          Novo produto
        </Button>
      </div>

      <div className={classes.table}>
        <div className={classes.head}>
          <span>Produto</span>
          <span>Seção</span>
          <span className={classes.right}>Preço</span>
          <span className={classes.right}>Estoque</span>
          <span>Status</span>
        </div>
        {data !== undefined && data.data.length === 0 && (
          <p className={classes.noResults}>Nenhum produto encontrado.</p>
        )}
        {data?.data.map((product) => (
          <Link key={product.id} to={`/produtos/${product.id}`} className={classes.row}>
            <span className={classes.product}>
              {product.photoUrl ? (
                <img className={classes.thumb} src={product.photoUrl} alt="" />
              ) : (
                <span className={classes.thumb} aria-hidden="true" />
              )}
              <span className={classes.names}>
                <span className={classes.name}>{product.name}</span>
                {product.description && <span className={classes.description}>{product.description}</span>}
              </span>
            </span>
            <span>{product.categoryId ? (sectionName.get(product.categoryId) ?? "—") : "—"}</span>
            <span className={`${classes.right} n`}>{formatCents(product.priceInCents)}</span>
            <span className={`${classes.right} ${classes[stockTone(product.stock)]} n`}>
              {stockText(product.stock)}
            </span>
            <span className={`${classes.badge} ${product.stock > 0 ? classes.available : classes.soldOut}`}>
              {product.stock > 0 ? "Disponível" : "Esgotado"}
            </span>
          </Link>
        ))}
        <div className={classes.footer}>
          <span className="n">{data ? `${shownUpTo} de ${data.total} produtos` : ""}</span>
          {/* Só existe depois que a primeira página carrega — otimista aqui
              (clicável antes de saber se há próxima página) navegaria para
              uma página que pode não existir, e o footer mostraria "N de N"
              sem explicar por que a tabela veio vazia. */}
          {data && (
            <div className={classes.pager}>
              <Button variant="default" disabled={page <= 1} onClick={() => setParam("page", String(page - 1))}>
                Anterior
              </Button>
              <Button
                variant="default"
                disabled={offset + PAGE_SIZE >= data.total}
                onClick={() => setParam("page", String(page + 1))}
              >
                Próxima
              </Button>
            </div>
          )}
        </div>
      </div>
      <p className={classes.note}>
        O estoque aparece só aqui. No cardápio público o cliente vê apenas disponível ou esgotado.
      </p>
    </div>
  );
}
