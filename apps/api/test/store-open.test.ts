import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.ts";
import { buildTestApp, createRestaurant, setOpeningHours } from "./helpers.ts";

/**
 * "A loja está aberta agora?"
 *
 * Três coisas se combinam aqui, e cada uma sozinha já é fonte de erro: o fuso
 * do restaurante, a faixa que atravessa a meia-noite, e a pausa manual.
 *
 * Os testes montam a grade a partir da hora ATUAL no fuso do restaurante, em
 * vez de horas fixas. Horas fixas fariam o teste passar de manhã e falhar à
 * noite — e este projeto já pagou por isso uma vez, com três testes que
 * assumiam que São Paulo e Manaus estão sempre na mesma data.
 */
describe("está aberto agora?", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  /** Dia da semana e hora locais do restaurante, agora, direto do Postgres. */
  async function agoraNoFuso(timezone: string) {
    const { rows } = await pool.query<{ dow: number; hora: string }>(
      `select extract(dow from now() at time zone $1)::int as dow,
              to_char(now() at time zone $1, 'HH24:MI') as hora`,
      [timezone],
    );
    return rows[0];
  }

  /** Soma minutos a "HH:MM", dando a volta na meia-noite. */
  function somaMinutos(hora: string, minutos: number): string {
    const [h, m] = hora.split(":").map(Number);
    const total = (h * 60 + m + minutos + 1440 * 2) % 1440;
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  }

  /**
   * Um fuso fixo (sem horário de verão) cuja hora local é `horaAlvo` agora
   * mesmo, qualquer que seja a hora real de quem roda o teste.
   *
   * `Etc/GMT` inverte o sinal (é a convenção POSIX que o tzdata segue):
   * `Etc/GMT-N` é UTC+N e `Etc/GMT+N` é UTC-N. O deslocamento escolhido fica
   * sempre entre -11 e +12, dentro da faixa que o tzdata garante (-12 a +14).
   */
  function fusoComHoraAtual(horaAlvo: number): string {
    const horaUtc = new Date().getUTCHours();
    const bruto = ((horaAlvo - horaUtc) % 24 + 24) % 24; // 0..23
    const deslocamento = bruto <= 12 ? bruto : bruto - 24;
    if (deslocamento === 0) return "Etc/GMT";
    return deslocamento > 0 ? `Etc/GMT-${deslocamento}` : `Etc/GMT+${-deslocamento}`;
  }

  async function isOpen(slug: string) {
    const response = await app.inject({ method: "GET", url: `/menu/${slug}` });
    return response.json();
  }

  it("aberto dentro da faixa", async () => {
    const restaurant = await createRestaurant(app, { slug: "aberta" });
    const { dow, hora } = await agoraNoFuso("America/Sao_Paulo");
    await setOpeningHours(app, restaurant, [
      { weekday: dow, opensAt: somaMinutos(hora, -60), closesAt: somaMinutos(hora, 60) },
    ]);

    expect((await isOpen("aberta")).isOpen).toBe(true);
  });

  it("fechado fora da faixa", async () => {
    const restaurant = await createRestaurant(app, { slug: "fechada" });
    const { dow, hora } = await agoraNoFuso("America/Sao_Paulo");
    await setOpeningHours(app, restaurant, [
      { weekday: dow, opensAt: somaMinutos(hora, 120), closesAt: somaMinutos(hora, 180) },
    ]);

    expect((await isOpen("fechada")).isOpen).toBe(false);
  });

  it("dia sem faixa é dia fechado", async () => {
    const restaurant = await createRestaurant(app, { slug: "sem-faixa" });
    const { dow, hora } = await agoraNoFuso("America/Sao_Paulo");
    // faixa cadastrada no dia SEGUINTE, cobrindo a hora atual
    await setOpeningHours(app, restaurant, [
      {
        weekday: ((dow + 1) % 7) as 0,
        opensAt: somaMinutos(hora, -60),
        closesAt: somaMinutos(hora, 60),
      },
    ]);

    expect((await isOpen("sem-faixa")).isOpen).toBe(false);
  });

  /**
   * A pizzaria que atende até as duas. A faixa cruza a meia-noite (22h–02h) e
   * é testada nas suas DUAS metades — cada metade só é alcançável em certas
   * horas locais: a metade "hoje à noite" só faz sentido se agora for noite
   * naquele fuso, e a metade "madrugada seguinte" só se agora for madrugada.
   *
   * Por isso cada teste escolhe o FUSO do restaurante (um deslocamento fixo,
   * sem horário de verão) de modo que a hora local seja sempre a mesma, não
   * importa a hora real de quem roda a suíte: a hora-alvo cai bem no meio da
   * metade da faixa que o teste quer exercitar. A faixa em si sai da hora
   * local real lida do Postgres, o que garante uma hora de folga de cada lado.
   */
  it("faixa que atravessa a meia-noite vale na própria noite", async () => {
    const timezone = fusoComHoraAtual(23); // meio da metade 22h–24h
    const restaurant = await createRestaurant(app, {
      slug: "noturna-noite",
      timezone,
    });
    const { dow, hora } = await agoraNoFuso(timezone);
    // A faixa sai da hora local REAL, não de "22:00" fixo: como agora são 23h
    // no fuso escolhido, somar 120 minutos dá a volta na meia-noite. Assim a
    // folga é de uma hora inteira para cada lado, e não do punhado de segundos
    // que sobraria se a faixa terminasse aos 02:00 em ponto.
    await setOpeningHours(app, restaurant, [
      { weekday: dow, opensAt: somaMinutos(hora, -60), closesAt: somaMinutos(hora, 120) },
    ]);

    expect((await isOpen("noturna-noite")).isOpen).toBe(true);
  });

  it("faixa que atravessa a meia-noite vale na madrugada seguinte", async () => {
    const timezone = fusoComHoraAtual(1); // meio da metade 00h–02h
    const restaurant = await createRestaurant(app, {
      slug: "noturna-madrugada",
      timezone,
    });
    const { dow, hora } = await agoraNoFuso(timezone);
    await setOpeningHours(app, restaurant, [
      // A faixa foi cadastrada ONTEM (relativo ao fuso escolhido) e ainda vale
      // agora, de madrugada. Sai da hora local real pelo mesmo motivo do teste
      // acima: agora é 01h, então -180 cai nas 22h de ontem e +60 nas 02h de
      // hoje, com uma hora de folga de cada lado.
      {
        weekday: ((dow + 6) % 7) as 0,
        opensAt: somaMinutos(hora, -180),
        closesAt: somaMinutos(hora, 60),
      },
    ]);

    expect((await isOpen("noturna-madrugada")).isOpen).toBe(true);
  });

  /**
   * O fuso decide. Dois restaurantes com a MESMA grade, fusos diferentes: a
   * faixa é montada em torno da hora de São Paulo, então o de Manaus (uma hora
   * atrás) está fora dela.
   */
  it("a mesma grade dá respostas diferentes em fusos diferentes", async () => {
    const sp = await createRestaurant(app, {
      slug: "sp",
      timezone: "America/Sao_Paulo",
    });
    const manaus = await createRestaurant(app, {
      slug: "manaus",
      timezone: "America/Manaus",
    });
    const { dow, hora } = await agoraNoFuso("America/Sao_Paulo");
    // faixa estreita: começa agora em SP e dura 30 minutos. Em Manaus são
    // 60 minutos mais cedo, logo fora dela.
    const grade = [
      { weekday: dow, opensAt: hora, closesAt: somaMinutos(hora, 30) },
    ];
    await setOpeningHours(app, sp, grade);
    await setOpeningHours(app, manaus, grade);

    expect((await isOpen("sp")).isOpen).toBe(true);
    expect((await isOpen("manaus")).isOpen).toBe(false);
  });

  /** A pausa fecha a loja mesmo dentro da faixa. */
  it("a pausa manual fecha a loja, e sai separada de isOpen", async () => {
    const restaurant = await createRestaurant(app, { slug: "pausada" });
    const { dow, hora } = await agoraNoFuso("America/Sao_Paulo");
    await setOpeningHours(app, restaurant, [
      { weekday: dow, opensAt: somaMinutos(hora, -60), closesAt: somaMinutos(hora, 60) },
    ]);

    await app.inject({
      method: "PATCH",
      url: `/restaurants/${restaurant.id}`,
      headers: restaurant.headers,
      payload: { acceptingOrders: false },
    });

    const body = await isOpen("pausada");
    expect(body.isOpen).toBe(false);
    // separado, para a tela distinguir "fechado agora" de "a loja pausou"
    expect(body.acceptingOrders).toBe(false);
  });

  it("o cardápio devolve a grade, para a tela dizer quando abre", async () => {
    const restaurant = await createRestaurant(app, { slug: "com-grade" });
    await setOpeningHours(app, restaurant, [
      { weekday: 1, opensAt: "18:00", closesAt: "23:00" },
    ]);

    const body = await isOpen("com-grade");

    expect(body.openingHours).toEqual([
      { weekday: 1, opensAt: "18:00", closesAt: "23:00" },
    ]);
  });

  it("restaurante sem grade nenhuma está fechado", async () => {
    await createRestaurant(app, { slug: "virgem" });

    expect((await isOpen("virgem")).isOpen).toBe(false);
  });
});
