import { Button } from "@mantine/core";
import { useState } from "react";
import { describeError } from "../../api/client.ts";
import { useSessionUser } from "../../auth/useMe.ts";
import { GroupCard } from "./GroupCard.tsx";
import { GroupFields } from "./GroupFields.tsx";
import { EMPTY_GROUP_FORM, type GroupForm, groupFormToBody, RULE_CARD, validateGroupForm } from "./optionGroups.ts";
import classes from "./OptionGroupsPage.module.css";
import { useCreateOptionGroup, useOptionGroups, useOptionGroupUsage } from "./useOptionGroups.ts";

function RuleCard() {
  return (
    <section className={classes.rules}>
      <h2 className={classes.rulesTitle}>Regra de preço — a escolha que muda o valor final</h2>
      <div className={classes.ruleGrid}>
        {RULE_CARD.map((rule) => (
          <div key={rule.rule} className={classes.rule}>
            <strong className={classes.ruleName}>{rule.name}</strong>
            <p className={classes.ruleHelp}>{rule.help}</p>
            <p className={`${classes.ruleExample} n`}>{rule.example}</p>
            <p className={classes.ruleWhen}>{rule.when}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function NewGroupCard({ restaurantId, onDone }: { restaurantId: string; onDone: () => void }) {
  const [form, setForm] = useState<GroupForm>(EMPTY_GROUP_FORM);
  const [problem, setProblem] = useState<string | null>(null);
  const create = useCreateOptionGroup(restaurantId);

  const submit = async () => {
    const found = validateGroupForm(form);
    setProblem(found);
    if (found !== null) return;
    try {
      await create.mutateAsync(groupFormToBody(form));
      onDone();
    } catch {
      // A mensagem da API sai de `create.error`.
    }
  };

  return (
    <section className={classes.group} aria-label="Novo grupo">
      <GroupFields form={form} onChange={setForm} />
      {problem !== null && (
        <p role="alert" className={classes.error}>
          {problem}
        </p>
      )}
      {create.isError && (
        <p role="alert" className={classes.error}>
          {describeError(create.error)}
        </p>
      )}
      <div className={classes.formActions}>
        <Button variant="default" onClick={onDone}>
          Cancelar
        </Button>
        <Button loading={create.isPending} onClick={() => void submit()}>
          Criar grupo
        </Button>
      </div>
    </section>
  );
}

export function OptionGroupsPage() {
  const { restaurantId } = useSessionUser();
  const groups = useOptionGroups(restaurantId);
  const usage = useOptionGroupUsage(restaurantId);
  const [creating, setCreating] = useState(false);

  // Carregando/erro só quando não há dado (a regra da 2a).
  if (groups.data === undefined) {
    return (
      <p className={classes.loading}>
        {groups.isError ? describeError(groups.error) : "Carregando grupos de opções…"}
      </p>
    );
  }

  const counts = usage.data?.counts;
  const truncated = usage.data?.truncated ?? false;

  return (
    <div className={classes.page}>
      <RuleCard />
      <div className={classes.toolbar}>
        <Button disabled={creating} onClick={() => setCreating(true)}>
          Novo grupo
        </Button>
      </div>
      {creating && <NewGroupCard restaurantId={restaurantId} onDone={() => setCreating(false)} />}
      {groups.data.length === 0 && !creating && <p className={classes.note}>Nenhum grupo cadastrado ainda.</p>}
      {groups.data.map((group) => (
        <GroupCard
          key={group.id}
          restaurantId={restaurantId}
          group={group}
          usage={counts === undefined ? undefined : (counts.get(group.id) ?? 0)}
          truncated={truncated}
        />
      ))}
    </div>
  );
}
