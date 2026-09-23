import { Button } from "@mantine/core";
import { useState } from "react";
import { describeError } from "../../api/client.ts";
import type { OptionGroup } from "../../api/types.ts";
import buttons from "../../ui/buttons.module.css";
import { ConfirmDialog } from "../../ui/ConfirmDialog.tsx";
import { Notice } from "../../ui/Notice.tsx";
import { GroupFields } from "./GroupFields.tsx";
import {
  changedGroupPatch,
  type GroupForm,
  groupToForm,
  RULE_NAMES,
  rangeLabel,
  removeGroupCopy,
  unreachable,
  unreachableMessage,
  usageLabel,
  validateGroupForm,
} from "./optionGroups.ts";
import classes from "./OptionGroupsPage.module.css";
import { NewOptionRow, OptionRow } from "./OptionRow.tsx";
import { useRemoveOptionGroup, useUpdateOptionGroup } from "./useOptionGroups.ts";

export function GroupCard({
  restaurantId,
  group,
  usage,
  truncated,
}: {
  restaurantId: string;
  group: OptionGroup;
  usage: number | undefined;
  truncated: boolean;
}) {
  const [editing, setEditing] = useState<GroupForm | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [adding, setAdding] = useState(false);
  // Cabeçalho e remoção são controles independentes: cada um com a sua mutação.
  const update = useUpdateOptionGroup(restaurantId, group.id);
  const remove = useRemoveOptionGroup(restaurantId, group.id);
  const gap = unreachable(group);

  const save = async () => {
    if (editing === null) return;
    const found = validateGroupForm(editing);
    setProblem(found);
    if (found !== null) return;
    const patch = changedGroupPatch(editing, group);
    if (Object.keys(patch).length === 0) {
      setEditing(null);
      return;
    }
    try {
      await update.mutateAsync(patch);
      setEditing(null);
    } catch {
      // A mensagem da API (409 de nome repetido, por exemplo) sai de `update.error`.
    }
  };

  const confirmRemove = async () => {
    try {
      await remove.mutateAsync();
    } catch {
      setConfirming(false);
    }
  };

  return (
    <section className={classes.group} aria-label={group.name}>
      {editing === null ? (
        <header className={classes.groupHead}>
          <h2 className={classes.groupName}>{group.name}</h2>
          <span className={`${classes.pill} n`}>{rangeLabel(group)}</span>
          <span className={`${classes.pill} ${classes.rulePill}`}>{RULE_NAMES[group.priceRule]}</span>
          <span className={`${classes.usage} n`}>{usageLabel(usage, truncated)}</span>
          <div className={classes.headActions}>
            <Button
              variant="subtle"
              aria-label={`Editar grupo ${group.name}`}
              onClick={() => {
                update.reset();
                setProblem(null);
                setEditing(groupToForm(group));
              }}
            >
              Editar
            </Button>
            <Button
              variant="subtle"
              className={buttons.dangerText}
              aria-label={`Remover grupo ${group.name}`}
              disabled={remove.isPending}
              onClick={() => {
                remove.reset();
                setConfirming(true);
              }}
            >
              Remover grupo
            </Button>
          </div>
        </header>
      ) : (
        <div>
          <GroupFields form={editing} onChange={setEditing} />
          <div className={classes.formActions}>
            <Button
              variant="default"
              onClick={() => {
                setEditing(null);
                setProblem(null);
              }}
            >
              Cancelar
            </Button>
            <Button loading={update.isPending} onClick={() => void save()}>
              Salvar grupo
            </Button>
          </div>
        </div>
      )}

      {problem !== null && (
        <p role="alert" className={classes.error}>
          {problem}
        </p>
      )}
      {update.isError && (
        <p role="alert" className={classes.error}>
          {describeError(update.error)}
        </p>
      )}
      {remove.isError && (
        <p role="alert" className={classes.error}>
          {describeError(remove.error)}
        </p>
      )}

      {gap !== null && <Notice tone="warn">{unreachableMessage(gap)}</Notice>}

      <div className={classes.table}>
        <div className={`${classes.tr} ${classes.th}`}>
          <span>Opção</span>
          <span className={classes.price}>Preço</span>
          <span>Qtd. máx.</span>
          <span>Disponível</span>
          <span />
        </div>
        {group.options.length === 0 && !adding && <p className={classes.noOptions}>Nenhuma opção cadastrada.</p>}
        <ul className={classes.rows}>
          {group.options.map((option) => (
            <OptionRow key={option.id} restaurantId={restaurantId} groupId={group.id} option={option} />
          ))}
          {adding && <NewOptionRow restaurantId={restaurantId} groupId={group.id} onDone={() => setAdding(false)} />}
        </ul>
        {!adding && (
          <button
            type="button"
            className={classes.dashed}
            aria-label={`Adicionar opção em ${group.name}`}
            onClick={() => setAdding(true)}
          >
            + Adicionar opção
          </button>
        )}
      </div>

      <ConfirmDialog
        copy={confirming ? removeGroupCopy(group.name, usage, truncated) : null}
        busy={remove.isPending}
        onConfirm={() => void confirmRemove()}
        onClose={() => setConfirming(false)}
      />
    </section>
  );
}
