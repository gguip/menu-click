import { ActionIcon, Button, NativeSelect, Textarea, TextInput } from "@mantine/core";
import { IconArrowDown, IconArrowLeft, IconArrowUp } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { listAllCategories } from "../../api/categories.ts";
import { describeError } from "../../api/client.ts";
import { listAllOptionGroups } from "../../api/optionGroups.ts";
import {
  createProduct,
  deleteProduct,
  getProduct,
  setProductOptionGroups,
  updateProduct,
} from "../../api/products.ts";
import type { Category, OptionGroup, Product } from "../../api/types.ts";
import { useSessionUser } from "../../auth/useMe.ts";
import { moveItem } from "../../lib/moveItem.ts";
import { describeSaveError, type ImageChange, KEEP, uploadImage } from "../../lib/upload.ts";
import buttons from "../../ui/buttons.module.css";
import { ConfirmDialog } from "../../ui/ConfirmDialog.tsx";
import { ImageField } from "../../ui/ImageField.tsx";
import { SaveBar } from "../../ui/SaveBar.tsx";
import { LEAVE_WITHOUT_ASKING } from "../../ui/unsavedChanges.ts";
import { optionGroupsQueryKey } from "../optionGroups/useOptionGroups.ts";
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

/**
 * O produto foi salvo; uma etapa de DEPOIS falhou (os grupos de opções, ou a
 * foto de um produto recém-criado). O `notice` é o texto inteiro para a tela.
 */
class SavedWithProblem extends Error {
  readonly productId: string;

  constructor(productId: string, notice: string) {
    super(notice);
    this.name = "SavedWithProblem";
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
  const [photo, setPhoto] = useState<ImageChange>(KEEP);
  const update = (patch: Partial<ProductForm>) => setForm((current) => ({ ...current, ...patch }));

  const save = useMutation({
    mutationFn: async (value: ValidProduct) => {
      // Produto que já existe: a foto sobe ANTES, e vai no mesmo PATCH — envio
      // que falha interrompe sem gravar nada.
      const photoPatch: { photoUrl?: string | null } = {};
      if (photo.kind === "remove") photoPatch.photoUrl = null;
      if (product && photo.kind === "replace") {
        photoPatch.photoUrl = await uploadImage(restaurantId, photo.file, "product", product.id);
      }
      const saved = product
        ? await updateProduct(restaurantId, product.id, { ...toUpdateBody(value), ...photoPatch })
        : await createProduct(restaurantId, toCreateBody(value));

      // Daqui para baixo o produto JÁ está salvo — e o erro precisa dizer
      // isso, senão a pessoa salva de novo e duplica. As duas etapas são
      // tentadas mesmo que a outra falhe.
      const problems: string[] = [];

      // Produto novo: o endereço da foto tem o id, que só existe agora.
      if (!product && photo.kind === "replace") {
        try {
          const photoUrl = await uploadImage(restaurantId, photo.file, "product", saved.id);
          await updateProduct(restaurantId, saved.id, { photoUrl });
        } catch {
          problems.push("Produto criado, mas a foto não subiu. Tente de novo.");
        }
      }
      if (!sameIds(product?.optionGroupIds ?? [], value.optionGroupIds)) {
        try {
          await setProductOptionGroups(restaurantId, saved.id, value.optionGroupIds);
        } catch (cause) {
          problems.push(`O produto foi salvo, mas os grupos de opções não: ${describeError(cause)}`);
        }
      }
      if (problems.length > 0) throw new SavedWithProblem(saved.id, problems.join(" "));
      return saved;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["products", restaurantId] });
      // o `productCount` de cada grupo vem da listagem de grupos
      void queryClient.invalidateQueries({ queryKey: optionGroupsQueryKey(restaurantId) });
      // a tela ainda está "suja" quando o salvar navega: sem a marca, o aviso
      // de alteração não salva perguntaria sobre o que acabou de ser salvo
      navigate("/produtos", { state: LEAVE_WITHOUT_ASKING });
    },
    onError: (cause) => {
      if (!(cause instanceof SavedWithProblem)) {
        setError(describeSaveError(cause));
        return;
      }
      void queryClient.invalidateQueries({ queryKey: ["products", restaurantId] });
      void queryClient.invalidateQueries({ queryKey: optionGroupsQueryKey(restaurantId) });
      if (product) setError(cause.message);
      // produto recém-criado: a tela passa a ser a de edição, senão salvar de
      // novo criaria um segundo produto
      else navigate(`/produtos/${cause.productId}`, {
        replace: true,
        state: { ...LEAVE_WITHOUT_ASKING, notice: cause.message },
      });
    },
  });

  const [removing, setRemoving] = useState(false);
  const remove = useMutation({
    mutationFn: (id: string) => deleteProduct(restaurantId, id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["products", restaurantId] });
      // a API tira o produto dos grupos junto: o "usado em N" muda
      void queryClient.invalidateQueries({ queryKey: optionGroupsQueryKey(restaurantId) });
      navigate("/produtos", { state: LEAVE_WITHOUT_ASKING });
    },
    onError: (cause) => {
      setRemoving(false);
      setError(describeError(cause));
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
            <ImageField
              label="Foto"
              description="JPG, PNG ou WebP, até 5 MB."
              saved={product?.photoUrl}
              change={photo}
              onChange={setPhoto}
            />
          </section>

          <section className={classes.card}>
            <h2 className={classes.cardTitle}>Grupos de opções</h2>
            <p className={classes.note}>
              A ordem aqui é a ordem que o cliente vê. Os grupos pertencem à loja — crie e edite em{" "}
              <Link to="/grupos-de-opcoes">Grupos de opções</Link>.
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
        {product && (
          <section className={classes.danger}>
            <h2 className={classes.dangerTitle}>Remover produto</h2>
            <p className={classes.dangerBody}>
              Sai do cardápio e da lista. Para tirar do ar só por um tempo, zere o estoque.
            </p>
            <Button
              className={buttons.danger}
              disabled={remove.isPending}
              onClick={() => setRemoving(true)}
            >
              Remover produto
            </Button>
          </section>
        )}
        {error && (
          <p role="alert" className={classes.error}>
            {error}
          </p>
        )}
      </div>
      {/* O handoff não desenha a remoção; a copy é desvio registrado na spec. */}
      <ConfirmDialog
        copy={
          removing && product
            ? {
                title: `Remover «${product.name}»?`,
                body: "O produto sai do cardápio e da lista. Pedidos que já o tiveram continuam com o nome e o preço de quando foram feitos.",
                warn: "Para tirar do ar só por um tempo, zere o estoque: remover não tem volta pelo painel.",
                cta: "Remover produto",
                tone: "danger",
              }
            : null
        }
        busy={remove.isPending}
        onClose={() => setRemoving(false)}
        onConfirm={() => {
          if (product) remove.mutate(product.id);
        }}
      />
      <SaveBar
        dirty={isDirty(form, initial) || photo.kind !== "keep"}
        busy={save.isPending}
        saveLabel="Salvar produto"
        onSave={submit}
        cancel={{ to: "/produtos" }}
      />
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
    queryKey: optionGroupsQueryKey(restaurantId),
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
