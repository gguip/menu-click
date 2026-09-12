import { createTransport } from "nodemailer";

/**
 * A porta de saída de e-mail.
 *
 * Existe para o resto do código não conhecer provedor nenhum: o serviço chama
 * `sendEmail` e pronto. Trocar de fornecedor é trocar `SMTP_URL`, não mexer em
 * código — foi por isso que a escolha foi SMTP por `nodemailer` em vez do SDK
 * de um provedor.
 */
export type Email = { to: string; subject: string; text: string };

export const EMAIL_DRIVERS = ["smtp", "console"] as const;
export type EmailDriver = (typeof EMAIL_DRIVERS)[number];

/**
 * O que o driver de console "enviou", para os testes lerem.
 *
 * É necessário: o banco guarda só o HASH do token, então não existe caminho
 * pelo banco para um teste descobrir o token e exercer o fluxo até o fim. Fica
 * vazio em produção porque o driver de console é recusado lá.
 */
export const outbox: Email[] = [];

/** Zera o `outbox`. Existe para um arquivo de teste não enxergar o do outro. */
export function clearOutbox(): void {
  outbox.length = 0;
}

/**
 * 🚨 O driver de console escreve o link no log, e o link **é** o token.
 *
 * Em produção isso derramaria credencial de troca de senha em log de
 * aplicação, que é exatamente o que o S13 proíbe. Falhar ao subir é a resposta
 * certa: um aviso seria ignorado até o dia em que fosse tarde.
 */
export function assertEmailDriverIsSafe(
  driver: string,
  nodeEnv: string | undefined,
): void {
  if (!(EMAIL_DRIVERS as readonly string[]).includes(driver)) {
    throw new Error(
      `EMAIL_DRIVER inválido: "${driver}". Use ${EMAIL_DRIVERS.join(" ou ")}`,
    );
  }
  if (driver === "console" && nodeEnv === "production") {
    throw new Error(
      "EMAIL_DRIVER=console em produção escreveria o token de recuperação no log. Configure SMTP_URL e use EMAIL_DRIVER=smtp",
    );
  }
}

/**
 * O transporte SMTP é caro de montar (resolve DNS, abre pool de conexão) e o
 * `SMTP_URL` não muda em runtime, então é montado uma vez só e reaproveitado —
 * é o próprio uso recomendado do `nodemailer` (um transporte por processo, não
 * um por e-mail).
 */
let smtpTransport: ReturnType<typeof createTransport> | undefined;

/**
 * Para onde o driver de console escreve.
 *
 * Injetado uma vez pelo `buildApp()`, como o `pool` é um singleton de módulo:
 * é o que dá log estruturado (F19) sem este módulo importar Fastify. Antes do
 * boot — ou num teste que não sobe o app — cai num descarte silencioso, porque
 * a alternativa seria `console.log`.
 */
let log: (mensagem: string) => void = () => {};

/** O driver que a guarda de boot aprovou. */
let resolvedDriver: EmailDriver | undefined;

function readDriver(): EmailDriver {
  return (process.env.EMAIL_DRIVER ?? "console") as EmailDriver;
}

/**
 * 🚨 Com `smtp`, as três variáveis do fluxo precisam existir NO BOOT.
 *
 * `SMTP_URL` e `EMAIL_FROM` já falhavam — mas só no primeiro envio, o que
 * significa descobrir o problema quando alguém já está trancado para fora.
 * `PASSWORD_RESET_URL` não falhava nunca: sem ela o link cai num default de
 * desenvolvimento, e a loja recebe um e-mail apontando para `localhost`.
 *
 * Esse é o pior dos três, e por isso entra aqui apesar de ser lida fora deste
 * módulo: um e-mail que chega com link errado é tão inútil quanto um que não
 * chega, e falha **sem erro nenhum** — ninguém descobre até o dono reclamar
 * que o link não abre. O fluxo inteiro existe para dar caminho de volta a quem
 * perdeu o acesso; entregá-lo quebrado em silêncio anula a feature.
 */
function assertSmtpConfigIsComplete(): void {
  const faltando = (["SMTP_URL", "EMAIL_FROM", "PASSWORD_RESET_URL"] as const)
    .filter((nome) => !process.env[nome]);

  if (faltando.length === 0) {
    // e a URL tem que ser PARSEÁVEL, não só existir: sem isto o processo sobe
    // e só quebra no primeiro envio — ou seja, quando alguém já está trancado
    // para fora e precisa dela. O validador já existia; faltava chamá-lo aqui.
    assertSmtpUrlIsParseable(process.env.SMTP_URL as string);
  }

  if (faltando.length > 0) {
    // só os NOMES, nunca os valores (S13)
    throw new Error(
      `EMAIL_DRIVER=smtp exige ${faltando.join(", ")} configurado(s)`,
    );
  }
}

/**
 * A fiação de boot, numa chamada só: valida o driver e injeta o log.
 *
 * `assertEmailDriverIsSafe` fica PURA de propósito — é o que permite testá-la
 * sem subir app nem mexer em `process.env`. Quem guarda o resultado é esta
 * função, e é o resultado guardado que o envio usa depois.
 */
export function configureEmail(
  driver: string,
  nodeEnv: string | undefined,
  logger: (mensagem: string) => void,
): void {
  assertEmailDriverIsSafe(driver, nodeEnv);
  if (driver === "smtp") assertSmtpConfigIsComplete();
  resolvedDriver = driver as EmailDriver;
  log = logger;
}

/**
 * 🚨 Valida a `SMTP_URL` **sem nunca deixar o valor entrar num erro**.
 *
 * Medido: três formas de URL malformada fazem o parser lançar com a senha
 * dentro, e por caminhos diferentes — `smtp://u:senha@h:abc` vaza em
 * `err.input`; `u:senha@host:587` e `://u:senha@h` vazam em `err.message` e
 * `err.stack`. Redigir uma chave só não resolveria, porque são três.
 *
 * Pior: com URL inválida o próprio Node imprime a string inteira no stderr
 * como DeprecationWarning, fora de qualquer logger nosso — nenhum `redact`
 * alcança isso. Por isso a defesa não é redigir o erro depois, é **nunca
 * produzir o erro**: valida-se aqui, e o `nodemailer` só recebe URL que já
 * passou.
 *
 * A mensagem lançada diz o nome da variável e nada do valor.
 */
function assertSmtpUrlIsParseable(url: string): void {
  try {
    new URL(url);
  } catch {
    // o erro original é descartado de propósito: ele carrega a URL
    throw new Error("SMTP_URL não é uma URL válida");
  }
}

function requiredEnv(name: "SMTP_URL" | "EMAIL_FROM"): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `EMAIL_DRIVER=smtp exige ${name} configurado`,
    );
  }
  return value;
}

async function sendViaSmtp(email: Email): Promise<void> {
  if (smtpTransport === undefined) {
    const url = requiredEnv("SMTP_URL");
    assertSmtpUrlIsParseable(url);
    smtpTransport = createTransport(url);
  }
  await smtpTransport.sendMail({
    from: requiredEnv("EMAIL_FROM"),
    to: email.to,
    subject: email.subject,
    text: email.text,
  });
}

/**
 * ⚠️ Escreve a mensagem inteira, não só o assunto — é o que permite a um
 * operador ler o link (o corpo do e-mail) e entregá-lo ao dono da conta antes
 * de existir provedor de SMTP configurado. Fora de produção, `console.log` é
 * a escolha certa: este módulo é uma porta de infraestrutura sem Fastify por
 * perto (a mesma razão de `db/seed.ts` não usar `app.log`), e `assertEmail-
 * DriverIsSafe` já garante que este caminho nunca roda em produção.
 *
 * Escreve pelo logger que o `buildApp()` injetou, e não por `console.log`: o
 * F19 é explícito, e um `console.log` escaparia do `redact` do pino além de
 * sujar um fluxo de log que é JSON no resto. O módulo continua sem conhecer
 * Fastify — recebe uma função de log, não a instância.
 */
function sendViaConsole(email: Email): void {
  outbox.push(email);
  log(
    `[email] para: ${email.to}\nassunto: ${email.subject}\n\n${email.text}`,
  );
}

/**
 * Envia um e-mail pelo driver escolhido em `EMAIL_DRIVER` (default `console`).
 *
 * Quem chama não sabe — nem precisa saber — qual dos dois está por trás.
 */
export async function sendEmail(email: Email): Promise<void> {
  // o driver validado no boot, não uma releitura da env: `assertEmailDriver-
  // IsSafe` só protege o que ele de fato decidiu, e reler aqui abriria a
  // fresta de algo mutar `process.env` depois da guarda ter passado
  const driver = resolvedDriver ?? readDriver();

  if (driver === "smtp") {
    await sendViaSmtp(email);
    return;
  }

  sendViaConsole(email);
}
