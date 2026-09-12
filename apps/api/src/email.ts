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
  smtpTransport ??= createTransport(requiredEnv("SMTP_URL"));
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
 * DriverIsSafe` já garante que este caminho nunca roda em produção — onde o
 * log de verdade (pino) é o único que existe.
 */
function sendViaConsole(email: Email): void {
  outbox.push(email);
  console.log(
    `[email] para: ${email.to}\nassunto: ${email.subject}\n\n${email.text}`,
  );
}

/**
 * Envia um e-mail pelo driver escolhido em `EMAIL_DRIVER` (default `console`).
 *
 * Quem chama não sabe — nem precisa saber — qual dos dois está por trás.
 */
export async function sendEmail(email: Email): Promise<void> {
  const driver = (process.env.EMAIL_DRIVER ?? "console") as EmailDriver;

  if (driver === "smtp") {
    await sendViaSmtp(email);
    return;
  }

  sendViaConsole(email);
}
