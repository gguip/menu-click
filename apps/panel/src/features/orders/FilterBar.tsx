import { Button, NativeSelect, Popover, TextInput } from "@mantine/core";
import { useState } from "react";
import type { Table } from "../../api/types.ts";
import classes from "./FilterBar.module.css";
import {
  formatRangeLabel,
  type OrderFilters,
  PERIODS,
  withPeriod,
  withRange,
} from "./orderFilters.ts";

export function FilterBar({
  filters,
  onChange,
  tables,
  syncLabel,
}: {
  filters: OrderFilters;
  onChange: (next: OrderFilters) => void;
  tables: readonly Table[];
  syncLabel: string;
}) {
  const [rangeOpen, setRangeOpen] = useState(false);
  const [from, setFrom] = useState(filters.from ?? "");
  const [to, setTo] = useState(filters.to ?? "");
  const rangeLabel =
    filters.from !== null && filters.to !== null ? formatRangeLabel(filters.from, filters.to) : null;

  return (
    <>
      <div className={classes.bar}>
        <div className={classes.segmented} role="group" aria-label="Período">
          {PERIODS.map((period) => (
            <button
              key={period.value}
              type="button"
              className={classes.segment}
              aria-pressed={filters.period === period.value}
              onClick={() => onChange(withPeriod(filters, period.value))}
            >
              {period.label}
            </button>
          ))}
        </div>

        {rangeLabel !== null ? (
          <button
            type="button"
            className={`${classes.dashed} ${classes.dashedActive}`}
            onClick={() => onChange(withPeriod(filters, "today"))}
          >
            {rangeLabel} · limpar
          </button>
        ) : (
          <Popover opened={rangeOpen} onChange={setRangeOpen} position="bottom-start">
            <Popover.Target>
              <button type="button" className={classes.dashed} onClick={() => setRangeOpen((open) => !open)}>
                Intervalo de datas
              </button>
            </Popover.Target>
            <Popover.Dropdown>
              <div className={classes.rangeForm}>
                <TextInput type="date" label="De" value={from} onChange={(e) => setFrom(e.currentTarget.value)} />
                <TextInput type="date" label="Até" value={to} onChange={(e) => setTo(e.currentTarget.value)} />
                <Button
                  disabled={from === "" || to === "" || from > to}
                  onClick={() => {
                    onChange(withRange(filters, from, to));
                    setRangeOpen(false);
                  }}
                >
                  Aplicar
                </Button>
              </div>
            </Popover.Dropdown>
          </Popover>
        )}

        {tables.length > 0 && (
          <NativeSelect
            aria-label="Mesa"
            classNames={{ input: filters.tableId !== null ? classes.tableActive : undefined }}
            value={filters.tableId ?? ""}
            onChange={(event) => onChange({ ...filters, tableId: event.currentTarget.value || null })}
            data={[
              { value: "", label: "Todas as mesas" },
              ...tables.map((table) => ({ value: table.id, label: table.label })),
            ]}
          />
        )}

        <div className={classes.right}>
          <span className={`${classes.sync} n`}>{syncLabel}</span>
          <NativeSelect
            aria-label="Ordenação"
            value={filters.sort}
            onChange={(event) =>
              onChange({ ...filters, sort: event.currentTarget.value === "value" ? "value" : "recent" })
            }
            data={[
              { value: "recent", label: "Mais recentes" },
              { value: "value", label: "Maior valor" },
            ]}
          />
        </div>
      </div>
      {rangeLabel !== null && (
        <p className={classes.rangeNote}>
          Intervalo de datas ativo — o filtro por período fica desligado. Os dois não se combinam.
        </p>
      )}
    </>
  );
}
