import { SHUTDOWN_DRAIN_TIMEOUT_MS } from "./limits.ts";

/**
 * Trabalho que continua depois da resposta.
 *
 * Três rotas respondem antes de terminar o serviço: o cadastro (manda o
 * e-mail de verificação), o reenvio, e o pedido de recuperação de senha. Nas
 * três o motivo é o mesmo — o tempo de resposta não pode denunciar se um
 * e-mail existe, e um provedor de SMTP lento não pode segurar a requisição.
 *
 * O problema de soltar uma promessa com `void` é que ninguém mais sabe dela:
 *
 * - **No encerramento**, o `app.close()` termina com o trabalho no meio, e o
 *   e-mail de verificação de quem acabou de se cadastrar some sem sintoma.
 * - **Nos testes**, o `truncate` do `afterEach` toma lock exclusivo e colide
 *   com o insert do token que ficou correndo. Medido: em três execuções da
 *   suíte, uma teve deadlock E uma falha de teste.
 *
 * Este módulo é o registro que faltava. `track()` guarda a promessa até ela
 * terminar; `drainBackgroundWork()` espera todas. Continua sendo fogo-e-esquece
 * do ponto de vista de quem chama — a rota não aguarda nada.
 */
const emAndamento = new Set<Promise<unknown>>();

/**
 * Registra uma promessa que roda fora do caminho da resposta.
 *
 * Quem chama NÃO deve dar `await`: o ponto é justamente não esperar. O
 * `.catch` de verdade — o que escreve no log — fica por conta de quem chama,
 * porque só ele sabe o que logar.
 *
 * ⚠️ O `.catch(() => {})` do fim não substitui aquele, e não é redundante com
 * ele. `work.finally(cb)` devolve uma promessa DERIVADA, que rejeita junto
 * quando `work` rejeita; solta com `void`, ninguém a trata, e o Node derruba o
 * processo por unhandled rejection — verificado, sai com código 1, e não há
 * `process.on("unhandledRejection")` em lugar nenhum do projeto. Hoje as três
 * chamadas põem o `.catch` antes de chamar aqui, então isto é rede e não
 * conserto: ela troca "um e-mail que falhou derruba a API inteira" por "um
 * e-mail que falhou some em silêncio". Pior que logar, muito melhor que cair.
 */
export function track(work: Promise<unknown>): void {
  emAndamento.add(work);
  void work.finally(() => emAndamento.delete(work)).catch(() => {});
}

/**
 * Espera todo o trabalho solto terminar.
 *
 * Usado pelo `onClose` (para não perder e-mail no encerramento) e pelo
 * `afterEach` dos testes (para o `truncate` não disputar lock com um insert
 * que ficou correndo).
 *
 * **A espera tem prazo por padrão**, `SHUTDOWN_DRAIN_TIMEOUT_MS`: vencido ele,
 * a função volta e o que sobrou segue correndo por conta própria. O padrão é
 * esse porque o caminho perigoso é o de produção — esperar sem limite no
 * `onClose` pendurava o `app.close()` atrás de um SMTP travado. Quem quiser
 * mesmo esperar para sempre chama `drainBackgroundWorkUnbounded()`, que diz
 * isso no nome; ninguém recria aquele defeito apagando um argumento.
 */
export async function drainBackgroundWork(
  timeoutMs: number = SHUTDOWN_DRAIN_TIMEOUT_MS,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const prazo = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });

  try {
    await Promise.race([esperarTudo(), prazo]);
  } finally {
    // sem isto o timer pendente segura o event loop e atrasa a saída do
    // processo pelo prazo inteiro — justamente no caminho do encerramento
    clearTimeout(timer);
  }
}

/**
 * Espera SEM prazo nenhum.
 *
 * ⚠️ Existe para o teste, e o nome é comprido de propósito. O `afterEach` de
 * `test/setup.ts` precisa que TODO o trabalho tenha acabado antes do
 * `truncate` — um dreno que desista no meio traz de volta o deadlock entre o
 * insert do token e o lock exclusivo do truncate, que foi o motivo deste
 * módulo existir. E ali, trabalho que não termina é sintoma a enxergar.
 *
 * **Em código de produção, não.** Foi por esperar sem prazo que o `onClose`
 * pendurou o `app.close()` atrás de um SMTP travado, com o `pool.end()` nunca
 * rodando (F26). É por isso que o prazo virou o PADRÃO do
 * `drainBackgroundWork` e a espera infinita virou esta função de nome feio:
 * antes bastava alguém apagar um argumento para recriar aquele defeito, e
 * nenhum teste avisaria. Agora recriá-lo exige chamar isto aqui, de propósito.
 */
export function drainBackgroundWorkUnbounded(): Promise<void> {
  return esperarTudo();
}

/**
 * O laço: espera o que está registrado, TIRA do conjunto o que já esperou, e
 * volta a conferir.
 *
 * ⚠️ Quem remove é este laço, depois do `await` — não o `finally` de `track()`
 * —, e é essa a diferença entre um dreno que termina e um que não termina. Na
 * primeira versão o laço só esperava, confiando no `finally` para esvaziar:
 * mas o `await` retoma como microtask e pode chegar ANTES dele, e aí o `while`
 * reentra com as mesmas promessas, já resolvidas, o `allSettled` volta na hora
 * e vira laço quente. Foi medido: um teste ficou 707 segundos preso assim.
 * Tirando explicitamente o que acabou de ser esperado, cada volta é menor que
 * a anterior, sem depender de quando o `finally` roda.
 *
 * ⚠️ E o conjunto continua CHEIO durante a espera, também de propósito: um
 * segundo dreno que comece no meio do primeiro enxerga o mesmo trabalho e
 * espera por ele. A versão que esvaziava antes de esperar fazia o segundo ver
 * conjunto vazio e voltar na hora dizendo "terminou" com trabalho ainda
 * correndo — reproduzido numa revisão.
 *
 * Trabalho registrado durante a espera fica no conjunto e cai na volta
 * seguinte, que é por que o laço existe.
 */
async function esperarTudo(): Promise<void> {
  while (emAndamento.size > 0) {
    const pendentes = [...emAndamento];
    await Promise.allSettled(pendentes);
    for (const promessa of pendentes) emAndamento.delete(promessa);
  }
}
