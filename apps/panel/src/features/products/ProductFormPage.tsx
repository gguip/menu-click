import { ActionIcon, Button, NativeSelect, Textarea, TextInput } from "@mantine/core";
import { IconArrowDown, IconArrowLeft, IconArrowUp } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { listAllCategories } from "../../api/categories.ts";
import { describeError } from "../../api/client.ts";
import { listAllOptionGroups } from "../../api/optionGroups.ts";
import { createProduct, getProduct, setProductOptionGroups, updateProduct } from "../../api/products.ts";
import type { Category, OptionGroup, Product } from "../../api/types.ts";
import { useSessionUser } from "../../auth/useMe.ts";
import { moveItem } from "../../lib/moveItem.ts";
import buttons from "../../ui/buttons.module.css";
import { PRICE_RULES } from "./priceRules.ts";
import classes from "./ProductFormPage.module.css";
import {
  EMPTY_FORM,
  fromProduct,
  isDirty,
  type ProductForm,
  sameIds,
  toCreateBody,
  toUpdateBody,
  validateProductForm,
  type ValidProduct,
} from "./productForm.ts";

/** O produto foi salvo; só o PUT dos grupos falhou. */
class GroupsNotSaved extends Error {
  readonly productId: string;

  constructor(productId: string, message: string) {
    super(message);
    this.name = "GroupsNotSaved";
    this.productId = productId;
  }
}

function ProductEditor({
  restaurantId,
  product,
  categories,
  groups,
}: {
  restaurantId: string;
  product: Product | undefined;
  categories: readonly Category[];
  groups: readonly OptionGroup[];
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const initial = product ? fromProduct(product) : EMPTY_FORM;
  const [form, setForm] = useState<ProductForm>(initial);
  const [error, setError] = useState<string | null>(
    (location.state as { notice?: string } | null)?.notice ?? null,
  );
  const update = (patch: Partial<ProductForm>) => setForm((current) => ({ ...current, ...patch }));

  const save = useMutation({
    mutationFn: async (value: ValidProduct) => {
      const saved = product
        ? await updateProduct(restaurantId, product.id, toUpdateBody(value))
        : await createProduct(restaurantId, toCreateBody(value));
      // Duas chamadas: se a segunda falhar, o produto JÁ está salvo — e o
      // erro precisa dizer isso, senão a pessoa salva de novo e duplica.
      if (!sameIds(product?.optionGroupIds ?? [], value.optionGroupIds)) {
        try {
          await setProductOptionGroups(restaurantId, saved.id, value.optionGroupIds);
        } catch (cause) {
          throw new GroupsNotSaved(saved.id, describeError(cause));
        }
      }
      return saved;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["products", restaurantId] });
      navigate("/produtos");
    },
    onError: (cause) => {
      if (!(cause instanceof GroupsNotSaved)) {
        setError(describeError(cause));
        return;
      }
      void queryClient.invalidateQueries({ queryKey: ["products", restaurantId] });
      const notice = `O produto foi salvo, mas os grupos de opções não: ${cause.message}`;
      if (product) setError(notice);
      // produto recém-criado: a tela passa a ser a de edição, senão salvar de
      // novo criaria um segundo produto
      else navigate(`/produtos/${cause.productId}`, { replace: true, state: { notice } });
    },
  });

  const submit = () => {
    const result = validateProductForm(form);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    save.mutate(result.value);
  };

  const available = groups.filter((group) => !form.optionGroupIds.includes(group.id));

  return (
    <>
      <div className={classes.page}>
        <Link to="/produtos" className={classes.back}>
          <IconArrowLeft size={14} /> Produtos
        </Link>
        <div className={classes.columns}>
          <section className={classes.card}>
            <h2 className={classes.cardTitle}>Dados do produto</h2>
            <TextInput label="Nome" value={form.name} onChange={(e) => update({ name: e.currentTarget.value })} />
            <Textarea
              label="Descrição"
              rows={3}
              placeholder="Massa fina, 8 fatias. Escolha até 2 sabores."
              value={form.description}
              onChange={(e) => update({ description: e.currentTarget.value })}
            />
            <div className={classes.priceRow}>
              <TextInput
                label="Preço (R$)"
                placeholder="0,00"
                inputMode="decimal"
                value={form.price}
                onChange={(e) => update({ price: e.currentTarget.value })}
              />
              <TextInput
                label="Estoque"
                inputMode="numeric"
                value={form.stock}
                onChange={(e) => update({ stock: e.currentTarget.value })}
              />
              <NativeSelect
                label="Seção"
                value={form.categoryId}
                onChange={(e) => update({ categoryId: e.currentTarget.value })}
                data={[
                  { value: "", label: "Sem seção" },
                  ...categories.map((category) => ({ value: category.id, label: category.name })),
                ]}
              />
            </div>
            <TextInput
              label="URL da foto"
              placeholder="https://"
              description="Ainda não há upload de imagem: cole o endereço de uma foto já publicada."
              value={form.photoUrl}
              onChange={(e) => update({ photoUrl: e.currentTarget.value })}
            />
          </section>

          <section className={classes.card}>
            <h2 className={classes.cardTitle}>Grupos de opções</h2>
            <p className={classes.note}>
              A ordem aqui é a ordem que o cliente vê. Os grupos pertencem à loja — crie e edite em Grupos
              de opções.
            </p>
            {form.optionGroupIds.map((id, index) => {
              const group = groups.find((candidate) => candidate.id === id);
              if (group === undefined) return null;
              const rule = PRICE_RULES[group.priceRule];
              return (
                <div key={id} className={classes.group}>
                  <div className={classes.arrows}>
                    <ActionIcon
                      variant="default"
                      size={26}
                      aria-label={`Subir ${group.name}`}
                      disabled={index === 0}
                      onClick={() => update({ optionGroupIds: moveItem(form.optionGroupIds, index, index - 1) })}
                    >
                      <IconArrowUp size={12} />
                    </ActionIcon>
                    <ActionIcon
                      variant="default"
                      size={26}
                      aria-label={`Descer ${group.name}`}
                      disabled={index === form.optionGroupIds.length - 1}
                      onClick={() => update({ optionGroupIds: moveItem(form.optionGroupIds, index, index + 1) })}
                    >
                      <IconArrowDown size={12} />
                    </ActionIcon>
                  </div>
                  <div className={classes.groupMain}>
                    <span>
                      <span className={classes.groupName}>{group.name}</span>{" "}
                      <span className={`${classes.range} n`}>
                        escolhe {group.minOptions} a {group.maxOptions}
                      </span>
                    </span>
                    <p className={classes.rule}>
                      <strong>{rule.name}</strong> — {rule.help}
                    </p>
                    <p className={classes.example}>{rule.example}</p>
                  </div>
                  <Button
                    variant="subtle"
                    className={buttons.dangerText}
                    aria-label={`Remover ${group.name}`}
                    onClick={() =>
                      update({ optionGroupIds: form.optionGroupIds.filter((groupId) => groupId !== id) })
                    }
                  >
                    Remover
                  </Button>
                </div>
              );
            })}
            {available.length > 0 && (
              <NativeSelect
                aria-label="Adicionar grupo já cadastrado"
                value=""
                onChange={(e) => {
                  const id = e.currentTarget.value;
                  if (id !== "") update({ optionGroupIds: [...form.optionGroupIds, id] });
                }}
                data={[
                  { value: "", label: "Adicionar grupo já cadastrado" },
                  ...available.map((group) => ({ value: group.id, label: group.name })),
                ]}
              />
            )}
          </section>
        </div>
        {error && (
          <p role="alert" className={classes.error}>
            {error}
          </p>
        )}
      </div>
      <div className={classes.saveBar}>
        {isDirty(form, initial) && <span className={classes.dirty}>Alterações não salvas</span>}
        <Button component={Link} to="/produtos" variant="default">
          Cancelar
        </Button>
        <Button loading={save.isPending} onClick={submit}>
          Salvar produto
        </Button>
      </div>
    </>
  );
}

export function ProductFormPage() {
  const { productId } = useParams();
  const { restaurantId } = useSessionUser();
  const product = useQuery({
    queryKey: ["products", restaurantId, "detail", productId],
    queryFn: () => getProduct(restaurantId, productId as string),
    enabled: productId !== undefined,
  });
  const categories = useQuery({
    queryKey: ["categories", restaurantId],
    queryFn: () => listAllCategories(restaurantId),
  });
  const groups = useQuery({
    queryKey: ["option-groups", restaurantId],
    queryFn: () => listAllOptionGroups(restaurantId),
  });

  if (productId !== undefined && product.isPending) {
    return <p className={classes.loading}>Carregando produto…</p>;
  }
  if (productId !== undefined && product.isError) {
    return <p className={classes.loading}>{describeError(product.error)}</p>;
  }
  // `key` recria o editor quando o produto muda: o estado do formulário nasce
  // dos dados, sem setState num efeito.
  return (
    <ProductEditor
      key={productId ?? "novo"}
      restaurantId={restaurantId}
      product={product.data}
      categories={categories.data ?? []}
      groups={groups.data ?? []}
    />
  );
}
