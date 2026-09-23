import { useSearchParams } from "react-router";
import { describeError } from "../../api/client.ts";
import type { Period } from "../../api/types.ts";
import { useSessionUser } from "../../auth/useMe.ts";
import { useNow } from "../../lib/useNow.ts";
import { PERIODS } from "../orders/orderFilters.ts";
import { usePeriodSummary } from "../orders/useSummary.ts";
import { bigNumbers, parsePeriod, READING_NOTES, statusRows, syncLabel } from "./summary.ts";
import classes from "./SummaryPage.module.css";

export function SummaryPage() {
  const { restaurantId } = useSessionUser();
  const [params, setParams] = useSearchParams();
  const period = parsePeriod(params.get("period"));
  // Com Hoje, é a MESMA query do header (`useTodaySummary`): uma chamada só,
  // e os dois lugares nunca divergem.
  const summary = usePeriodSummary(restaurantId, period);
  const now = useNow();

  const choose = (next: Period) => {
    setParams(next === "today" ? {} : { period: next });
  };

  return (
    <div className={classes.page}>
      <div className={classes.bar}>
        <div className={classes.segmented} role="group" aria-label="Período">
          {PERIODS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={classes.segment}
              aria-pressed={period === option.value}
              onClick={() => choose(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        {summary.dataUpdatedAt > 0 && (
          <span className={`${classes.sync} n`}>{syncLabel(period, summary.dataUpdatedAt, now)}</span>
        )}
      </div>

      {summary.data === undefined ? (
        // Carregando/erro só quando não há dado: um refetch que falha mantém
        // os números antigos na tela.
        <p className={classes.loading}>
          {summary.isError ? describeError(summary.error) : "Carregando resumo…"}
        </p>
      ) : (
        <>
          <div className={classes.numbers}>
            {bigNumbers(summary.data).map((number) => (
              <section key={number.label} className={classes.number} aria-label={number.label}>
                <span className={classes.eyebrow}>{number.label}</span>
                <strong className={`${classes.value} n`}>{number.value}</strong>
                <span className={classes.sub}>{number.sub}</span>
              </section>
            ))}
          </div>

          <section className={classes.card}>
            <h2 className={classes.cardTitle}>Pedidos por status</h2>
            <ul className={classes.rows}>
              {statusRows(summary.data.counts).map((row) => (
                <li key={row.label} className={classes.row}>
                  <span className={classes.label}>
                    <span className={`${classes.dot} ${classes[`tone_${row.tone}`]}`} aria-hidden="true" />
                    {row.label}
                  </span>
                  <span className={`${classes.count} n`}>{row.count}</span>
                  <span className={classes.track} aria-hidden="true">
                    <span
                      className={`${classes.fill} ${classes[`tone_${row.tone}`]}`}
                      style={{ width: `${Math.round(row.share * 100)}%` }}
                    />
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className={classes.card}>
            <h2 className={classes.cardTitle}>Como ler estes números</h2>
            <div className={classes.notes}>
              {READING_NOTES.map((note) => (
                <p key={note.head} className={classes.note}>
                  <strong className={classes.noteHead}>{note.head}</strong> {note.body}
                </p>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
