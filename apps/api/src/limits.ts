/**
 * Os limites de exposição da API, num lugar só.
 *
 * Ficam fora do `app.ts` por dois motivos. O primeiro é prático: a rota de
 * login precisa do próprio teto, e importá-lo do `app.ts` — que importa as
 * rotas — fecharia um ciclo. O segundo é que "quanto esta API aceita" é uma
 * decisão de operação, e ter tudo em um arquivo torna a revisão possível: cada
 * número abaixo tem o porquê escrito ao lado, e nenhum deles é o default
 * (F27/S16).
 */

/**
 * Maior corpo aceito. O default do Fastify é 1 MB; o maior corpo real desta API
 * é um cadastro (restaurante + usuário) ou um pedido com muitos itens, que não
 * passam de dezenas de KB. 128 KB deixa margem larga para os dois e ainda
 * assim recusa upload acidental antes de ele ocupar memória (F27/S16).
 */
export const BODY_LIMIT_BYTES = 128 * 1024;

/**
 * Quanto uma conexão ociosa com keep-alive sobrevive.
 *
 * Tem que ser **maior** que o idle timeout do proxy à frente (F24). Se for
 * menor, existe a janela em que a app fecha a conexão no mesmo instante em que
 * o proxy manda a requisição seguinte por ela — e isso vira 502 intermitente,
 * do tipo que ninguém reproduz. O default do Node é 5s; a maioria dos
 * balanceadores usa 60s, então 72s deixa folga em cima do caso comum.
 */
export const KEEP_ALIVE_TIMEOUT_MS = 72_000;

/**
 * Teto para uma conexão que abre e não completa a requisição. O default é 0
 * (sem limite), que é um socket preso de graça.
 */
export const CONNECTION_TIMEOUT_MS = 10_000;

/**
 * A app confia no `X-Forwarded-For`?
 *
 * Precisa ser `true` **exatamente** quando houver um proxy à frente, e `false`
 * caso contrário — os dois erros custam caro, em direções opostas:
 *
 * - `false` atrás de proxy: `request.ip` é o IP do proxy, o mesmo para todo
 *   mundo. Rate limit por IP deixa de proteger e passa a atrapalhar, porque o
 *   teto vira compartilhado entre todos os clientes juntos.
 * - `true` exposto direto: qualquer um forja o header e escolhe o próprio IP,
 *   e o rate limit vira decorativo.
 *
 * Default `false` porque é o que vale em desenvolvimento e nos testes. Ligar é
 * decisão de quem faz o deploy, e está documentada no `.env.example`.
 */
export const TRUST_PROXY = process.env.TRUST_PROXY === "true";

/**
 * Teto global por IP, por minuto. Folgado de propósito: cobre o cardápio
 * público e a criação de pedido (as duas rotas anônimas de uso legítimo) sem
 * atrapalhar quem está navegando, e ainda assim recusa varredura.
 */
export const RATE_LIMIT_MAX = 100;

/**
 * Teto do `/auth/login`, muito menor — é o alvo real.
 *
 * Não é só força bruta contra senha. A rota é anônima e **cara de propósito**:
 * bcrypt a custo 12 gasta centenas de milissegundos, e a defesa contra oráculo
 * de timing (rodar o hash mesmo quando o e-mail não existe) faz com que uma
 * tentativa com e-mail inventado custe o mesmo que uma legítima. Como o
 * `bcrypt.compare` roda no threadpool do libuv — 4 threads por padrão —, uma
 * enxurrada de logins põe todo o resto que depende do threadpool numa fila.
 */
export const LOGIN_RATE_LIMIT_MAX = 5;

/**
 * Teto da cotação de frete (`POST /menu/:slug/delivery-quote`), muito abaixo
 * do global — mesmo motivo do login (S25).
 *
 * A cotação é anônima e vai disparar chamada externa na Parte 2 (Nominatim,
 * que limita 1 req/s e bane quem abusa). Teto próprio pelo mesmo motivo do
 * `/auth/login`: rota anônima e cara não pode dividir o teto geral com as
 * baratas.
 */
export const DELIVERY_QUOTE_RATE_LIMIT_MAX = 20;

/**
 * Teto do `/auth/forgot-password`, mesmo motivo do login (S25): rota anônima
 * e cara. Aqui o custo não é bcrypt, é o e-mail — cada tentativa dispara um
 * envio, que gasta dinheiro e reputação de domínio (provedores de SMTP
 * suspendem quem manda volume demais). Por IP e não por e-mail, pela mesma
 * razão do login: por e-mail viraria uma forma de impedir que o dono
 * legítimo recupere a própria conta.
 */
export const PASSWORD_RESET_RATE_LIMIT_MAX = 5;

/**
 * Teto do `/auth/verify-email`, mesmo perfil do S25: rota anônima, e o custo
 * de uma tentativa não é o bcrypt (o token não passa por hash caro) — é o
 * banco. O token tem 256 bits, então adivinhar um de verdade continua
 * inviável mesmo sem este teto; o que ele limita é o tamanho da varredura que
 * um IP consegue fazer contra a tabela por minuto, e evita que esta rota
 * anônima divida o teto global de 100/min com as legítimas (cardápio,
 * criação de pedido). Mesmo número do `/auth/reset-password`, que é a rota
 * irmã (mesma forma de token, mesma exposição anônima).
 */
export const EMAIL_VERIFICATION_RATE_LIMIT_MAX = 5;

/**
 * Teto do `/auth/resend-verification` — e aqui a chave **não é o IP**, que é a
 * diferença que importa. A rota exige sessão, então existe sinal melhor que o
 * endereço de rede: a conta. Por IP, duas lojas na mesma praça de alimentação
 * (ou atrás do mesmo CGNAT) dividiriam o teto, e o botão de "não recebi o
 * e-mail" pararia de funcionar para a segunda — justamente quem precisa dele
 * (S30). O S25 manda usar IP em rota **anônima**, onde não há outra chave; não
 * é o caso desta.
 *
 * O teto existe porque cada chamada manda um e-mail DE VERDADE. Sem ele a rota
 * herda o teto global de 100/min e uma sessão sozinha dispara 100 envios por
 * minuto: conta do provedor, e reputação do domínio — que é o que faz e-mail
 * legítimo começar a cair na caixa de spam de quem não tem nada com isso.
 * Três por minuto cobrem com folga "cliquei, não chegou, cliquei de novo".
 */
export const EMAIL_RESEND_RATE_LIMIT_MAX = 3;

export const RATE_LIMIT_WINDOW = "1 minute";

/**
 * Quanto o encerramento espera pelo trabalho que roda depois da resposta (os
 * e-mails de verificação e de recuperação) antes de fechar o pool.
 *
 * ⚠️ O prazo existe porque esperar sem limite é pior que perder o e-mail. O
 * `onClose` é o caminho do `SIGTERM` (F26), e o nodemailer tem timeouts
 * próprios largos — 2 minutos para conectar, 10 para o socket. Um SMTP travado
 * seguraria o `app.close()` muito além dos 10 a 30 segundos que um
 * orquestrador costuma dar, e aí quem encerra o processo é o SIGKILL: o pool
 * nunca chega a fechar direito, que é exatamente o que o hook queria garantir.
 * Cinco segundos dão folga para um envio normal terminar e mantêm o
 * encerramento dentro de qualquer janela de deploy.
 */
export const SHUTDOWN_DRAIN_TIMEOUT_MS = 5_000;

/**
 * Origens autorizadas a chamar a API de dentro de um navegador.
 *
 * Lista separada por vírgula em `CORS_ORIGINS`. **Sem a variável, nenhuma
 * origem cruzada passa** — falha fechado, que é o lado certo para errar: um
 * esquecimento em produção quebra o front (visível na hora) em vez de abrir a
 * API para qualquer site (invisível até dar errado).
 *
 * Não há `credentials: true` e não deve haver: a API se autentica pelo header
 * `Authorization`, não por cookie. Sem credenciais no jogo, some de saída a
 * combinação clássica de `origin: "*"` com cookie de sessão.
 *
 * É função, e não constante, porque o valor é lido a cada `buildApp()`: assim
 * o teste consegue montar uma app com a lista configurada e outra sem ela, que
 * são justamente os dois casos que precisam de prova.
 */
export function corsOrigins(): string[] {
  return (process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((origem) => origem.trim())
    .filter((origem) => origem !== "");
}
