import { NativeSelect, TextInput } from "@mantine/core";
import type { PriceRule } from "../../api/types.ts";
import { type GroupForm, RULE_CARD } from "./optionGroups.ts";
import classes from "./OptionGroupsPage.module.css";

/** Os mesmos campos no grupo novo e na edição do cabeçalho. */
export function GroupFields({ form, onChange }: { form: GroupForm; onChange: (form: GroupForm) => void }) {
  return (
    <div className={classes.fields}>
      <TextInput
        label="Nome do grupo"
        value={form.name}
        onChange={(event) => onChange({ ...form, name: event.currentTarget.value })}
      />
      <TextInput
        label="Mínimo"
        value={form.minOptions}
        onChange={(event) => onChange({ ...form, minOptions: event.currentTarget.value })}
      />
      <TextInput
        label="Máximo"
        value={form.maxOptions}
        onChange={(event) => onChange({ ...form, maxOptions: event.currentTarget.value })}
      />
      <NativeSelect
        label="Regra de preço"
        value={form.priceRule}
        data={RULE_CARD.map((rule) => ({ value: rule.rule, label: rule.name }))}
        onChange={(event) => onChange({ ...form, priceRule: event.currentTarget.value as PriceRule })}
      />
    </div>
  );
}
