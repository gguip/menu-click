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
 * `.catch` fica por conta de quem chama, porque só ele sabe o que logar.
 */
export function track(work: Promise<unknown>): void {
  emAndamento.add(work);
  void work.finally(() => emAndamento.delete(work));
}

/**
 * Espera todo o trabalho solto terminar.
 *
 * Usado pelo `onClose` (para não perder e-mail no encerramento) e pelo
 * `afterEach` dos testes (para o `truncate` não disputar lock com um insert
 * que ficou correndo). Repete enquanto houver trabalho, porque uma tarefa
 * pode registrar outra.
 */
export async function drainBackgroundWork(): Promise<void> {
  while (emAndamento.size > 0) {
    // ⚠️ Esvazia o conjunto ANTES de esperar, e isso não é detalhe.
    //
    // Esperando sem esvaziar, o `await` retoma como microtask e pode chegar
    // antes dos `finally` que removem cada promessa — o `while` reentra com as
    // mesmas, ja resolvidas, o `allSettled` volta na hora, e vira laco quente
    // que nunca sai. Foi medido: um teste ficou 707 segundos preso assim.
    //
    // Tirando primeiro, cada volta espera exatamente o que estava registrado.
    // Trabalho que se registrar durante a espera cai na volta seguinte, que e
    // por isso que o laco existe.
    const pendentes = [...emAndamento];
    emAndamento.clear();
    await Promise.allSettled(pendentes);
  }
}
