import { Button, Switch, TextInput } from "@mantine/core";
import { useState } from "react";
import { describeError } from "../../api/client.ts";
import type { Option } from "../../api/types.ts";
import { formatCents } from "../../lib/money.ts";
import buttons from "../../ui/buttons.module.css";
import {
  changedOptionPatch,
  EMPTY_OPTION_FORM,
  type OptionForm,
  optionFormToBody,
  optionToForm,
  validateOptionForm,
} from "./optionGroups.ts";
import classes from "./OptionGroupsPage.module.css";
import { useCreateOption, useRemoveOption, useToggleOptionAvailable, useUpdateOption } from "./useOptionGroups.ts";

function OptionFields({ form, onChange }: { form: OptionForm; onChange: (form: OptionForm) => void }) {
  return (
    <>
      <TextInput
        aria-label="Nome da opção"
        placeholder="Opção"
        value={form.name}
        onChange={(event) => onChange({ ...form, name: event.currentTarget.value })}
      />
      <TextInput
        aria-label="Preço da opção"
        placeholder="0,00"
        value={form.price}
        onChange={(event) => onChange({ ...form, price: event.currentTarget.value })}
      />
      <TextInput
        aria-label="Qtd. máx. da opção"
        value={form.maxQuantity}
        onChange={(event) => onChange({ ...form, maxQuantity: event.currentTarget.value })}
      />
    </>
  );
}

function Errors({ messages }: { messages: (string | null)[] }) {
  return (
    <>
      {messages
        .filter((message): message is string => message !== null)
        // O índice na lista já filtrada serve de `key`: duas mutações podem
        // falhar com o MESMO texto (rede fora), e usar o texto como `key`
        // colidiria — a lista é recalculada inteira a cada render, então o
        // índice não carrega identidade de item nenhuma para se perder.
        .map((message, index) => (
          <p key={index} role="alert" className={classes.error}>
            {message}
          </p>
        ))}
    </>
  );
}

/**
 * Três controles independentes na mesma linha — salvar, remover e o
 * interruptor —, cada um com a SUA mutação (ver `CLAUDE.md`: uma instância
 * dividida perde os callbacks da chamada anterior).
 */
export function OptionRow({ restaurantId, groupId, option }: { restaurantId: string; groupId: string; option: Option }) {
  const [editing, setEditing] = useState<OptionForm | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const update = useUpdateOption(restaurantId, groupId, option.id);
  const remove = useRemoveOption(restaurantId, groupId, option.id);
  const toggle = useToggleOptionAvailable(restaurantId, groupId, option.id);

  const save = async () => {
    if (editing === null) return;
    const found = validateOptionForm(editing);
    setProblem(found);
    if (found !== null) return;
    const patch = changedOptionPatch(editing, option);
    if (Object.keys(patch).length === 0) {
      setEditing(null);
      return;
    }
    try {
      await update.mutateAsync(patch);
      setEditing(null);
    } catch {
      // A mensagem sai de `update.error`.
    }
  };

  const errors = [
    problem,
    update.isError ? describeError(update.error) : null,
    remove.isError ? describeError(remove.error) : null,
    toggle.isError ? describeError(toggle.error) : null,
  ];

  if (editing !== null) {
    return (
      <li>
        <div className={classes.tr}>
          <OptionFields form={editing} onChange={setEditing} />
          <span />
          <span />
        </div>
        <div className={classes.formActions}>
          <Button
            variant="subtle"
            className={buttons.dangerText}
            aria-label={`Remover ${option.name}`}
            loading={remove.isPending}
            onClick={() => remove.mutate()}
          >
            Remover
          </Button>
          <Button
            variant="default"
            onClick={() => {
              setEditing(null);
              setProblem(null);
            }}
          >
            Cancelar
          </Button>
          <Button aria-label={`Salvar ${option.name}`} loading={update.isPending} onClick={() => void save()}>
            Salvar
          </Button>
        </div>
        <Errors messages={errors} />
      </li>
    );
  }

  return (
    <li>
      <div className={classes.tr}>
        <span className={classes.cell}>{option.name}</span>
        <span className={`${classes.cell} ${classes.price} n`}>{formatCents(option.priceInCents)}</span>
        <span className={`${classes.cell} n`}>{option.maxQuantity}</span>
        <Switch
          aria-label={`Disponível: ${option.name}`}
          checked={option.available}
          onChange={(event) => toggle.mutate(event.currentTarget.checked)}
        />
        <Button
          variant="subtle"
          aria-label={`Editar ${option.name}`}
          onClick={() => {
            update.reset();
            remove.reset();
            setProblem(null);
            setEditing(optionToForm(option));
          }}
        >
          Editar
        </Button>
      </div>
      <Errors messages={errors} />
    </li>
  );
}

export function NewOptionRow({
  restaurantId,
  groupId,
  onDone,
}: {
  restaurantId: string;
  groupId: string;
  onDone: () => void;
}) {
  const [form, setForm] = useState<OptionForm>(EMPTY_OPTION_FORM);
  const [problem, setProblem] = useState<string | null>(null);
  const create = useCreateOption(restaurantId, groupId);

  const submit = async () => {
    const found = validateOptionForm(form);
    setProblem(found);
    if (found !== null) return;
    try {
      await create.mutateAsync(optionFormToBody(form));
      onDone();
    } catch {
      // A mensagem sai de `create.error`.
    }
  };

  return (
    <li>
      <div className={classes.tr}>
        <OptionFields form={form} onChange={setForm} />
        <span />
        <span />
      </div>
      <div className={classes.formActions}>
        <Button variant="default" onClick={onDone}>
          Cancelar
        </Button>
        <Button loading={create.isPending} onClick={() => void submit()}>
          Adicionar
        </Button>
      </div>
      <Errors messages={[problem, create.isError ? describeError(create.error) : null]} />
    </li>
  );
}
