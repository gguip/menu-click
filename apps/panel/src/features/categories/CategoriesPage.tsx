import { ActionIcon, Button, TextInput } from "@mantine/core";
import { IconArrowDown, IconArrowUp } from "@tabler/icons-react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import {
  countProductsInCategory,
  createCategory,
  deleteCategory,
  listAllCategories,
  moveCategory,
  renameCategory,
} from "../../api/categories.ts";
import { describeError } from "../../api/client.ts";
import type { Category } from "../../api/types.ts";
import { useSessionUser } from "../../auth/useMe.ts";
import { moveItem } from "../../lib/moveItem.ts";
import buttons from "../../ui/buttons.module.css";
import { ConfirmDialog } from "../../ui/ConfirmDialog.tsx";
import { Notice } from "../../ui/Notice.tsx";
import classes from "./CategoriesPage.module.css";
import { findDuplicate, positionUpdates } from "./reorder.ts";

export function countLabel(count: number | undefined): string {
  if (count === undefined) return "…";
  if (count === 0) return "sem produtos";
  return count === 1 ? "1 produto" : `${count} produtos`;
}

export function CategoriesPage() {
  const { restaurantId } = useSessionUser();
  const queryClient = useQueryClient();
  const key = ["categories", restaurantId];
  const categories = useQuery({ queryKey: key, queryFn: () => listAllCategories(restaurantId) });
  const list = categories.data ?? [];
  const counts = useQueries({
    queries: list.map((category) => ({
      queryKey: ["categories", restaurantId, "count", category.id],
      queryFn: () => countProductsInCategory(restaurantId, category.id),
      staleTime: 30_000,
    })),
  });

  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [removing, setRemoving] = useState<Category | null>(null);
  const [duplicate, setDuplicate] = useState<{ existing: string; typed: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const fail = (cause: unknown) => setError(describeError(cause));

  const create = useMutation({
    mutationFn: (name: string) => createCategory(restaurantId, name),
    onSuccess: () => {
      setNewName("");
      void refresh();
    },
    onError: fail,
  });
  const rename = useMutation({
    mutationFn: (value: { id: string; name: string }) => renameCategory(restaurantId, value.id, value.name),
    onSuccess: () => {
      setEditing(null);
      void refresh();
    },
    onError: fail,
  });
  const reorder = useMutation({
    mutationFn: async (ordered: Category[]) => {
      for (const update of positionUpdates(ordered)) {
        await moveCategory(restaurantId, update.id, update.position);
      }
    },
    // a lista já aparece na ordem nova enquanto os PATCH correm
    onMutate: (ordered) =>
      queryClient.setQueryData(
        key,
        ordered.map((category, index) => ({ ...category, position: index })),
      ),
    onError: fail,
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteCategory(restaurantId, id),
    onSuccess: () => {
      setRemoving(null);
      void refresh();
    },
    onError: (cause) => {
      setRemoving(null);
      fail(cause);
    },
  });

  /** Barra o nome repetido antes da API; o 409 dela fica como rede. */
  const acceptName = (name: string, exceptId?: string): boolean => {
    const existing = findDuplicate(name, list, exceptId);
    setDuplicate(existing ? { existing: existing.name, typed: name.trim() } : null);
    return existing === undefined;
  };

  const submitNew = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const name = newName.trim();
    if (name === "" || !acceptName(name)) return;
    create.mutate(name);
  };

  const submitRename = (event: FormEvent) => {
    event.preventDefault();
    if (editing === null) return;
    setError(null);
    const name = editing.name.trim();
    if (name === "" || !acceptName(name, editing.id)) return;
    rename.mutate({ id: editing.id, name });
  };

  return (
    <div className={classes.page}>
      <p className={classes.note}>
        A ordem é a ordem da refeição, não alfabética — e é exatamente o que o cliente vê no cardápio.
      </p>
      <section className={classes.card}>
        <ul className={classes.list}>
          {list.map((category, index) => (
            <li key={category.id} className={classes.row} aria-label={category.name}>
              <div className={classes.arrows}>
                <ActionIcon
                  variant="default"
                  size={30}
                  aria-label={`Subir ${category.name}`}
                  disabled={index === 0 || reorder.isPending}
                  onClick={() => reorder.mutate(moveItem(list, index, index - 1))}
                >
                  <IconArrowUp size={14} />
                </ActionIcon>
                <ActionIcon
                  variant="default"
                  size={30}
                  aria-label={`Descer ${category.name}`}
                  disabled={index === list.length - 1 || reorder.isPending}
                  onClick={() => reorder.mutate(moveItem(list, index, index + 1))}
                >
                  <IconArrowDown size={14} />
                </ActionIcon>
              </div>
              <span className={`${classes.position} n`}>{index + 1}</span>
              {editing?.id === category.id ? (
                <form className={classes.renameForm} onSubmit={submitRename}>
                  <TextInput
                    aria-label="Novo nome da seção"
                    value={editing.name}
                    onChange={(event) => setEditing({ id: category.id, name: event.currentTarget.value })}
                  />
                  <Button type="submit" loading={rename.isPending}>
                    Salvar
                  </Button>
                  <Button variant="default" onClick={() => setEditing(null)}>
                    Cancelar
                  </Button>
                </form>
              ) : (
                <>
                  <div className={classes.info}>
                    <span className={classes.name}>{category.name}</span>
                    <span className={`${classes.count} n`}>{countLabel(counts[index]?.data)}</span>
                  </div>
                  <Button variant="subtle" onClick={() => setEditing({ id: category.id, name: category.name })}>
                    Renomear
                  </Button>
                  <Button variant="subtle" className={buttons.dangerText} onClick={() => setRemoving(category)}>
                    Remover
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
        <form className={classes.footer} onSubmit={submitNew}>
          <TextInput
            aria-label="Nome da nova seção"
            placeholder="Nome da nova seção"
            value={newName}
            error={duplicate !== null}
            onChange={(event) => setNewName(event.currentTarget.value)}
          />
          <Button type="submit" loading={create.isPending}>
            Adicionar
          </Button>
        </form>
      </section>
      {duplicate && (
        <Notice tone="danger" title="Já existe uma seção com esse nome">
          {`"${duplicate.existing}" já está cadastrada. O nome não diferencia maiúsculas: "${duplicate.typed}" conta como repetido.`}
        </Notice>
      )}
      {error && (
        <p role="alert" className={classes.error}>
          {error}
        </p>
      )}
      <ConfirmDialog
        copy={
          removing && {
            title: `Remover a seção "${removing.name}"?`,
            body: 'Os produtos dela não são apagados: passam para um grupo "Sem categoria" no fim do cardápio, e continuam à venda.',
            cta: "Remover seção",
            tone: "danger",
          }
        }
        busy={remove.isPending}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) remove.mutate(removing.id);
        }}
      />
    </div>
  );
}
