import { Button, TextInput } from "@mantine/core";
import { useState } from "react";
import { describeError } from "../../api/client.ts";
import { useSessionUser } from "../../auth/useMe.ts";
import { SaveBar } from "../../ui/SaveBar.tsx";
import { PauseSwitch } from "../../layout/PauseSwitch.tsx";
import { useRestaurant } from "../restaurant/useRestaurant.ts";
import {
  addRange,
  crossesMidnight,
  type Day,
  daySummary,
  fromApi,
  removeRange,
  setRangeTime,
  toApi,
  validate,
} from "./openingHours.ts";
import classes from "./OpeningHoursPage.module.css";
import { useOpeningHours, useSaveOpeningHours } from "./useOpeningHours.ts";

function OpeningHoursEditor({ restaurantId, initial }: { restaurantId: string; initial: Day[] }) {
  const [days, setDays] = useState(initial);
  const [baseline, setBaseline] = useState(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const save = useSaveOpeningHours(restaurantId);
  const restaurant = useRestaurant(restaurantId);

  const dirty = JSON.stringify(days) !== JSON.stringify(baseline);

  const submit = () => {
    const found = validate(days);
    setProblem(found);
    if (found !== null) return;
    save.mutate(toApi(days), {
      onSuccess: (hours) => {
        const next = fromApi(hours);
        setDays(next);
        setBaseline(next);
      },
    });
  };

  return (
    <>
      <div className={classes.page}>
        <p className={classes.note}>
          Um dia pode ter mais de uma faixa — é assim que se declara o fechamento entre o almoço e o
          jantar. Dia sem faixa nenhuma é dia fechado.
        </p>

        <section className={classes.card}>
          <ul className={classes.list}>
            {days.map((day) => {
              const name = day.label.toLocaleLowerCase("pt-BR");
              return (
                <li key={day.weekday} className={classes.day} aria-label={day.label}>
                  <div className={classes.dayName}>
                    <span className={classes.name}>{day.label}</span>
                    <span
                      className={`${classes.state} ${day.ranges.length > 0 ? classes.open : ""}`}
                    >
                      {daySummary(day)}
                    </span>
                  </div>
                  <div className={classes.ranges}>
                    {day.ranges.map((range, index) => (
                      <div key={index} className={classes.range}>
                        <TextInput
                          type="time"
                          className={classes.time}
                          aria-label={`${day.label}: abre (faixa ${index + 1})`}
                          value={range.opensAt}
                          onChange={(event) =>
                            setDays(
                              setRangeTime(days, day.weekday, index, "opensAt", event.currentTarget.value),
                            )
                          }
                        />
                        <span className={classes.until}>até</span>
                        <TextInput
                          type="time"
                          className={classes.time}
                          aria-label={`${day.label}: fecha (faixa ${index + 1})`}
                          value={range.closesAt}
                          onChange={(event) =>
                            setDays(
                              setRangeTime(days, day.weekday, index, "closesAt", event.currentTarget.value),
                            )
                          }
                        />
                        {crossesMidnight(range) && (
                          <span className={classes.overnight}>vira a madrugada</span>
                        )}
                        <Button
                          variant="subtle"
                          aria-label={`Remover faixa ${index + 1} de ${name}`}
                          onClick={() => setDays(removeRange(days, day.weekday, index))}
                        >
                          Remover faixa
                        </Button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className={classes.dashed}
                      aria-label={`Adicionar faixa em ${name}`}
                      onClick={() => setDays(addRange(days, day.weekday))}
                    >
                      + Adicionar faixa
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <p className={classes.note}>
          Faixa que termina antes de começar é normal, não erro: 18:00 até 02:00 é a pizzaria que
          atende até as duas da manhã.
        </p>

        {problem !== null && (
          <p role="alert" className={classes.error}>
            {problem}
          </p>
        )}
        {save.isError && (
          <p role="alert" className={classes.error}>
            {describeError(save.error)}
          </p>
        )}

        <section className={classes.pause}>
          <h2 className={classes.pauseTitle}>Parar de aceitar pedidos agora</h2>
          <p className={classes.pauseBody}>
            É o botão de cozinha afogada, e não mexe no horário cadastrado. Ele está sempre na barra do
            topo — daqui é só o mesmo interruptor.
          </p>
          <PauseSwitch restaurantId={restaurantId} restaurant={restaurant.data} />
        </section>
      </div>
      <SaveBar
        dirty={dirty}
        busy={save.isPending}
        saveLabel="Salvar horário"
        onSave={submit}
        cancel={{
          onClick: () => {
            setDays(baseline);
            setProblem(null);
          },
        }}
      />
    </>
  );
}

export function OpeningHoursPage() {
  const { restaurantId } = useSessionUser();
  const hours = useOpeningHours(restaurantId);

  // Carregando/erro só quando não há dado: um refetch que falha ao
  // reconectar mantém `data` antigo, e checar `isError` primeiro trocaria a
  // grade que a pessoa está editando pela mensagem de erro.
  if (hours.data === undefined) {
    return (
      <p className={classes.loading}>
        {hours.isError ? describeError(hours.error) : "Carregando horário…"}
      </p>
    );
  }
  // O editor nasce com os dados em mãos: estado de formulário vindo de props,
  // sem setState em efeito.
  return <OpeningHoursEditor restaurantId={restaurantId} initial={fromApi(hours.data)} />;
}
