import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  LOGIN_RATE_LIMIT_MAX,
  PASSWORD_RESET_RATE_LIMIT_MAX,
  RATE_LIMIT_MAX,
} from "../src/limits.ts";
import { buildTestApp, registerRestaurant } from "./helpers.ts";

/**
 * Rate limit por IP.
 *
 * Estes testes passam `remoteAddress` explicitamente e **repetem o mesmo IP de
 * propósito** — é o oposto do resto da suíte, onde cada teste ganha um IP
 * próprio justamente para não esbarrar aqui.
 *
 * Rodam contra os valores reais de produção (`limits.ts`), não contra números
 * afrouxados para teste: um limite que só existe na configuração de teste não
 * prova nada sobre o que vai para o ar.
 */
describe("rate limit", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  /** Um IP diferente por teste daqui, para um não gastar a cota do outro. */
  let ipCounter = 0;
  function ipDedicado(): string {
    ipCounter += 1;
    return `192.168.7.${ipCounter}`;
  }

  it(`o ${PASSWORD_RESET_RATE_LIMIT_MAX + 1}º pedido de recuperação do mesmo IP é 429`, async () => {
    // as irmãs com teto próprio (login e cotação de frete) já têm caso
    // dedicado; sem este, o teto da recuperação existiria só em `limits.ts`
    const remoteAddress = ipDedicado();
    const payload = { email: "ninguem@lugar.com" };

    const respostas = [];
    for (let i = 0; i < PASSWORD_RESET_RATE_LIMIT_MAX + 1; i++) {
      respostas.push(
        await app.inject({
          method: "POST",
          url: "/auth/forgot-password",
          remoteAddress,
          payload,
        }),
      );
    }

    // as primeiras respondem 202 mesmo sem o e-mail existir (é o que fecha o
    // oráculo de enumeração); a excedente é recusada pelo limite
    expect(
      respostas.slice(0, PASSWORD_RESET_RATE_LIMIT_MAX).map((r) => r.statusCode),
    ).toEqual(Array(PASSWORD_RESET_RATE_LIMIT_MAX).fill(202));
    expect(respostas.at(-1)?.statusCode).toBe(429);
  });

  it(`o ${LOGIN_RATE_LIMIT_MAX + 1}º login do mesmo IP é 429`, async () => {
    const remoteAddress = ipDedicado();
    const payload = { email: "ninguem@lugar.com", password: "senha-errada-1" };

    const respostas = [];
    for (let i = 0; i < LOGIN_RATE_LIMIT_MAX + 1; i++) {
      respostas.push(
        await app.inject({
          method: "POST",
          url: "/auth/login",
          remoteAddress,
          payload,
        }),
      );
    }

    // as primeiras falham por credencial (401), a excedente por limite (429)
    expect(
      respostas.slice(0, LOGIN_RATE_LIMIT_MAX).map((r) => r.statusCode),
    ).toEqual(Array(LOGIN_RATE_LIMIT_MAX).fill(401));
    expect(respostas.at(-1)?.statusCode).toBe(429);
  });

  it("o 429 usa o mesmo formato de erro do resto da API", async () => {
    const remoteAddress = ipDedicado();
    for (let i = 0; i < LOGIN_RATE_LIMIT_MAX + 1; i++) {
      await app.inject({
        method: "POST",
        url: "/auth/login",
        remoteAddress,
        payload: { email: "ninguem@lugar.com", password: "senha-errada-1" },
      });
    }

    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      remoteAddress,
      payload: { email: "ninguem@lugar.com", password: "senha-errada-1" },
    });

    expect(response.statusCode).toBe(429);
    expect(response.json()).toMatchObject({
      statusCode: 429,
      error: "Too Many Requests",
    });
    expect(response.json().message).toEqual(expect.any(String));
  });

  /**
   * Sem isto o limite seria pior que inútil: um IP esgotando a cota derrubaria
   * o login de todo mundo.
   */
  it("a cota é por IP: outro IP continua entrando normalmente", async () => {
    const atacante = ipDedicado();
    const legitimo = ipDedicado();
    const { user, password } = await registerRestaurant(app);

    for (let i = 0; i < LOGIN_RATE_LIMIT_MAX + 1; i++) {
      await app.inject({
        method: "POST",
        url: "/auth/login",
        remoteAddress: atacante,
        payload: { email: user.email, password: "senha-errada-1" },
      });
    }

    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      remoteAddress: legitimo,
      payload: { email: user.email, password },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().token).toEqual(expect.any(String));
  });

  it("o login tem teto próprio, muito abaixo do global", () => {
    // se alguém igualar os dois, o login deixa de ser especialmente protegido
    // sem que nenhum outro teste perceba
    expect(LOGIN_RATE_LIMIT_MAX).toBeLessThan(RATE_LIMIT_MAX);
  });

  it("o teto global vale para as rotas públicas anônimas", async () => {
    const remoteAddress = ipDedicado();

    let ultima = 0;
    for (let i = 0; i < RATE_LIMIT_MAX + 1; i++) {
      const response = await app.inject({
        method: "GET",
        url: "/menu/nao-existe",
        remoteAddress,
      });
      ultima = response.statusCode;
    }

    // as primeiras respondem 404 (slug inexistente); a excedente, 429
    expect(ultima).toBe(429);
  });

  /**
   * Documenta a ordem real, que é o oposto do que o instinto sugere e não é
   * escolha nossa: o plugin instala a checagem como hook de rota, e hook de
   * rota roda DEPOIS dos hooks de instância — logo, depois da autenticação.
   *
   * A consequência é que enxurrada sem token numa rota protegida nunca chega a
   * ser contada. Isso é aceitável porque também não custa nada: sem header
   * `Authorization`, o `authenticate` lança antes de qualquer consulta ao
   * banco. E no `/auth/login`, que é onde mora o custo de verdade (bcrypt), a
   * rota é pública — a autenticação devolve na primeira linha e o limitador
   * roda antes do hash.
   */
  it("em rota protegida, a autenticação recusa antes de o limite contar", async () => {
    const remoteAddress = ipDedicado();

    let ultima = 0;
    for (let i = 0; i < RATE_LIMIT_MAX + 5; i++) {
      const response = await app.inject({
        method: "GET",
        url: "/restaurants",
        remoteAddress,
      });
      ultima = response.statusCode;
    }

    // continua 401, não 429: o contador nem foi tocado
    expect(ultima).toBe(401);
  });

  it("no login, o limite vale mesmo sem sessão (a rota é pública)", async () => {
    const remoteAddress = ipDedicado();

    let ultima = 0;
    for (let i = 0; i < LOGIN_RATE_LIMIT_MAX + 1; i++) {
      const response = await app.inject({
        method: "POST",
        url: "/auth/login",
        remoteAddress,
        payload: { email: "ninguem@lugar.com", password: "senha-errada-1" },
      });
      ultima = response.statusCode;
    }

    expect(ultima).toBe(429);
  });
});
