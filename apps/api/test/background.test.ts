import { describe, expect, it } from "vitest";
import { drainBackgroundWork, track } from "../src/background.ts";

/**
 * O registro de trabalho que roda depois da resposta (`src/background.ts`).
 *
 * Sem banco e sem app de propósito: as três propriedades abaixo são do módulo,
 * e cada uma delas já quebrou uma vez nesta branch — o laço quente que prendeu
 * um teste por 707 segundos, o dreno concorrente que voltava cedo, e o
 * `app.close()` que esperava sem prazo. Nenhuma delas tinha teste: a revisão da
 * branch aplicou duas mutações ao mesmo tempo e a suíte inteira passou.
 *
 * 🚨 Todo teste daqui LIBERA o trabalho que registrou antes de terminar. O
 * `afterEach` de `setup.ts` chama `drainBackgroundWork()` **sem prazo**, então
 * uma promessa que nunca resolve não deixaria o teste vermelho — penduraria a
 * suíte inteira.
 */
describe("trabalho depois da resposta", () => {
  /**
   * Uma promessa que só termina quando o teste mandar. É o que substitui
   * "esperar um tempinho": nada aqui depende de quanto tempo passou, só de
   * quem já foi liberado.
   */
  function adiado() {
    let resolve: () => void = () => {};
    let reject: (motivo: unknown) => void = () => {};
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  /**
   * O prazo do `onClose` (F26): vencido ele, o encerramento segue e o pool
   * fecha. Sem esta propriedade, um SMTP travado pendura o `app.close()` até o
   * SIGKILL — que foi exatamente o defeito que a revisão da Task 4 achou.
   *
   * A asserção é sobre o trabalho, não sobre o relógio: o dreno volta com o
   * envio ainda no meio, por mais lenta que a máquina esteja.
   */
  it("o dreno com prazo volta com o trabalho ainda correndo", async () => {
    const envio = adiado();
    let terminou = false;
    track(
      envio.promise.then(() => {
        terminou = true;
      }),
    );

    await drainBackgroundWork(10);

    expect(terminou).toBe(false);

    // e o que sobrou continua correndo por conta própria: liberado, o dreno
    // sem prazo o encontra e espera
    envio.resolve();
    await drainBackgroundWork();
    expect(terminou).toBe(true);
  });

  /**
   * ⚠️ `work.finally(cb)` devolve uma promessa DERIVADA, que rejeita junto com
   * `work`. Solta com `void` e sem `.catch`, ninguém a trata e o Node derruba o
   * processo por unhandled rejection (verificado: sai com código 1, e não há
   * `process.on("unhandledRejection")` em lugar nenhum do projeto).
   *
   * Aqui quem chama NÃO põe `.catch` de propósito — as três rotas põem, mas o
   * `.catch` do `track` é a rede que garante que um e-mail falhado nunca
   * derrube a API, e é essa rede que este teste prende.
   */
  it("promessa rejeitada não derruba o processo", async () => {
    const envio = adiado();
    track(envio.promise);

    envio.reject(new Error("SMTP fora do ar"));

    await expect(drainBackgroundWork()).resolves.toBeUndefined();
  });

  /**
   * ⚠️ O conjunto continua CHEIO durante a espera, e quem remove é o laço,
   * depois do `await`. Esvaziar antes fazia um segundo dreno, começado no meio
   * do primeiro, enxergar conjunto vazio e voltar dizendo "terminou" com
   * trabalho ainda correndo.
   *
   * Cada dreno olha o estado do trabalho NO INSTANTE em que ele próprio volta
   * — conferir depois, no fim do teste, encontraria tudo pronto e não provaria
   * nada. E o trabalho só é liberado DEPOIS de uma volta do event loop: quem
   * volta cedo volta em microtask, então liberar antes disso deixaria a versão
   * errada passar (medido — foi a primeira forma deste teste).
   */
  it("dois drenos concorrentes só voltam quando o trabalho acaba", async () => {
    const envio = adiado();
    let terminou = false;
    track(
      envio.promise.then(() => {
        terminou = true;
      }),
    );

    let primeiroVoltou = false;
    let segundoVoltou = false;
    const primeiro = drainBackgroundWork().then(() => {
      primeiroVoltou = true;
      return terminou;
    });
    // começa com o primeiro já em espera: é a condição que a versão errada
    // atravessava
    const segundo = drainBackgroundWork().then(() => {
      segundoVoltou = true;
      return terminou;
    });

    // uma volta do event loop esvazia a fila de microtasks inteira: dreno que
    // fosse voltar cedo já teria voltado aqui. Não é espera cronometrada —
    // `setImmediate` é um turno, não um prazo
    await new Promise((resolve) => setImmediate(resolve));

    expect(primeiroVoltou).toBe(false);
    expect(segundoVoltou).toBe(false);

    envio.resolve();

    expect(await primeiro).toBe(true);
    expect(await segundo).toBe(true);
  });
});
