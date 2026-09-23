import { Button, Checkbox, TextInput } from "@mantine/core";
import { type FormEvent, useState } from "react";
import QRCode from "react-qr-code";
import { describeError } from "../../api/client.ts";
import type { Table } from "../../api/types.ts";
import { useSessionUser } from "../../auth/useMe.ts";
import buttons from "../../ui/buttons.module.css";
import { ConfirmDialog } from "../../ui/ConfirmDialog.tsx";
import { Notice } from "../../ui/Notice.tsx";
import { useRestaurant } from "../restaurant/useRestaurant.ts";
import { PrintSheet } from "./PrintSheet.tsx";
import {
  allSelected,
  labelError,
  printButtonLabel,
  removeConfirm,
  rotateConfirm,
  selectAllLabel,
  toggleSelection,
  visibleSelection,
} from "./tables.ts";
import classes from "./TablesPage.module.css";
import {
  useCreateTable,
  useRemoveTable,
  useRenameTable,
  useRotateTableHash,
  useTablesList,
} from "./useTablesAdmin.ts";

/**
 * O cartão é um componente próprio porque cada mesa precisa das SUAS
 * instâncias de mutação: no query-core 5, `mutate()` desanexa o observer da
 * mutação anterior, e cartões dividindo uma instância perderiam a mensagem de
 * erro de um `PATCH` sobreposto a outro.
 */
function TableCard({
  restaurantId,
  table,
  selected,
  onToggle,
}: {
  restaurantId: string;
  table: Table;
  selected: boolean;
  onToggle: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<"rotate" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rename = useRenameTable(restaurantId, table.id);
  const rotate = useRotateTableHash(restaurantId, table.id);
  const remove = useRemoveTable(restaurantId, table.id);

  const submitRename = (event: FormEvent) => {
    event.preventDefault();
    if (editing === null) return;
    const problem = labelError(editing);
    setError(problem);
    if (problem !== null) return;
    rename.mutate(editing.trim(), {
      onSuccess: () => {
        setEditing(null);
        setError(null);
      },
      onError: (cause) => setError(describeError(cause)),
    });
  };

  return (
    <div className={selected ? `${classes.card} ${classes.cardSelected}` : classes.card}>
      {/* `div`, não `label`: o Checkbox do Mantine já renderiza o próprio
          `label` internamente, e aninhar um dentro do outro é HTML inválido.
          O `aria-label` do Checkbox já nomeia o controle. */}
      <div className={classes.pick}>
        <Checkbox size="18" checked={selected} onChange={onToggle} aria-label={`Selecionar ${table.label}`} />
        <span className={classes.label}>{table.label}</span>
      </div>
      <div className={classes.qr}>
        <QRCode value={table.qrUrl} size={104} level="Q" />
      </div>
      <span className={classes.url}>{table.qrUrl}</span>
      {editing === null ? (
        <div className={classes.actions}>
          <Button
            variant="subtle"
            size="compact-sm"
            px={6}
            aria-label={`Renomear ${table.label}`}
            onClick={() => setEditing(table.label)}
          >
            Renomear
          </Button>
          <Button
            variant="subtle"
            size="compact-sm"
            px={6}
            aria-label={`Novo código ${table.label}`}
            onClick={() => setConfirming("rotate")}
          >
            Novo código
          </Button>
          <Button
            variant="subtle"
            size="compact-sm"
            px={6}
            className={buttons.dangerText}
            aria-label={`Remover ${table.label}`}
            onClick={() => setConfirming("remove")}
          >
            Remover
          </Button>
        </div>
      ) : (
        <form className={classes.renameForm} onSubmit={submitRename}>
          <TextInput
            aria-label="Novo rótulo da mesa"
            value={editing}
            onChange={(event) => setEditing(event.currentTarget.value)}
          />
          <div className={classes.renameActions}>
            <Button type="submit" loading={rename.isPending}>
              Salvar
            </Button>
            <Button
              variant="default"
              onClick={() => {
                setEditing(null);
                setError(null);
              }}
            >
              Cancelar
            </Button>
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className={classes.error}>
          {error}
        </p>
      )}
      <ConfirmDialog
        copy={
          confirming === "rotate"
            ? rotateConfirm(table.label)
            : confirming === "remove"
              ? removeConfirm(table.label)
              : null
        }
        busy={rotate.isPending || remove.isPending}
        onClose={() => setConfirming(null)}
        onConfirm={() => {
          const action = confirming === "rotate" ? rotate : remove;
          action.mutate(undefined, {
            onSuccess: () => setConfirming(null),
            onError: (cause) => {
              setConfirming(null);
              setError(describeError(cause));
            },
          });
        }}
      />
    </div>
  );
}

export function TablesPage() {
  const { restaurantId } = useSessionUser();
  const tables = useTablesList(restaurantId);
  const list = tables.data ?? [];

  const [selected, setSelected] = useState<string[]>([]);
  const [newLabel, setNewLabel] = useState("");
  const [newError, setNewError] = useState<string | null>(null);

  const restaurant = useRestaurant(restaurantId);
  const visible = visibleSelection(selected, list);
  const everything = allSelected(selected, list);
  const chosen = list.filter((table) => visible.includes(table.id));
  const create = useCreateTable(restaurantId);

  const submitNew = (event: FormEvent) => {
    event.preventDefault();
    const problem = labelError(newLabel);
    setNewError(problem);
    if (problem !== null) return;
    create.mutate(newLabel.trim(), {
      onSuccess: () => {
        setNewLabel("");
        setNewError(null);
      },
      onError: (cause) => setNewError(describeError(cause)),
    });
  };

  return (
    <div className={classes.page}>
      <p className={classes.note}>
        Renomear a mesa não invalida o adesivo: o QR continua funcionando. O que invalida é gerar um código
        novo.
      </p>
      {tables.isError && tables.data === undefined && (
        <Notice tone="danger" title="Não foi possível carregar as mesas">
          {describeError(tables.error)}
        </Notice>
      )}
      <div className={classes.bar}>
        <Button
          variant="default"
          disabled={list.length === 0}
          onClick={() => setSelected(everything ? [] : list.map((table) => table.id))}
        >
          {selectAllLabel(everything)}
        </Button>
        <Button disabled={visible.length === 0} onClick={() => window.print()}>
          {printButtonLabel(visible.length)}
        </Button>
      </div>
      <div className={classes.grid}>
        {list.map((table) => (
          <TableCard
            key={table.id}
            restaurantId={restaurantId}
            table={table}
            selected={selected.includes(table.id)}
            onToggle={() => setSelected((current) => toggleSelection(current, table.id))}
          />
        ))}
        <form className={classes.newCard} onSubmit={submitNew}>
          <TextInput
            aria-label="Rótulo da nova mesa"
            placeholder="Mesa 7"
            value={newLabel}
            onChange={(event) => setNewLabel(event.currentTarget.value)}
          />
          <Button type="submit" loading={create.isPending}>
            Cadastrar mesa
          </Button>
          {newError && (
            <p role="alert" className={classes.error}>
              {newError}
            </p>
          )}
        </form>
      </div>
      <PrintSheet storeName={restaurant.data?.name ?? ""} tables={chosen} />
    </div>
  );
}
