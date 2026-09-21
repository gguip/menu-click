import type { OptionGroup } from "../../api/types.ts";
import { formatCents } from "../../lib/money.ts";
import { Notice } from "../../ui/Notice.tsx";
import { RULE_NAMES, rangeLabel, unreachable, unreachableMessage, usageLabel } from "./optionGroups.ts";
import classes from "./OptionGroupsPage.module.css";

export function GroupCard({
  group,
  usage,
  truncated,
}: {
  restaurantId: string;
  group: OptionGroup;
  usage: number | undefined;
  truncated: boolean;
}) {
  const gap = unreachable(group);
  return (
    <section className={classes.group} aria-label={group.name}>
      <header className={classes.groupHead}>
        <h2 className={classes.groupName}>{group.name}</h2>
        <span className={`${classes.pill} n`}>{rangeLabel(group)}</span>
        <span className={`${classes.pill} ${classes.rulePill}`}>{RULE_NAMES[group.priceRule]}</span>
        <span className={`${classes.usage} n`}>{usageLabel(usage, truncated)}</span>
      </header>

      {gap !== null && <Notice tone="warn">{unreachableMessage(gap)}</Notice>}

      <div className={classes.table}>
        <div className={`${classes.tr} ${classes.th}`}>
          <span>Opção</span>
          <span className={classes.price}>Preço</span>
          <span>Qtd. máx.</span>
          <span />
          <span />
        </div>
        {group.options.length === 0 ? (
          <p className={classes.noOptions}>Nenhuma opção cadastrada.</p>
        ) : (
          <ul className={classes.rows}>
            {group.options.map((option) => (
              <li key={option.id} className={classes.tr}>
                <span className={classes.cell}>{option.name}</span>
                <span className={`${classes.cell} ${classes.price} n`}>{formatCents(option.priceInCents)}</span>
                <span className={`${classes.cell} n`}>{option.maxQuantity}</span>
                <span />
                <span />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
