import { describeError } from "../../api/client.ts";
import { useSessionUser } from "../../auth/useMe.ts";
import { GroupCard } from "./GroupCard.tsx";
import { RULE_CARD } from "./optionGroups.ts";
import classes from "./OptionGroupsPage.module.css";
import { useOptionGroups, useOptionGroupUsage } from "./useOptionGroups.ts";

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

export function OptionGroupsPage() {
  const { restaurantId } = useSessionUser();
  const groups = useOptionGroups(restaurantId);
  const usage = useOptionGroupUsage(restaurantId);

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
      {groups.data.length === 0 && <p className={classes.note}>Nenhum grupo cadastrado ainda.</p>}
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
