import type { RestaurantUser, UserRole } from "../../api/types.ts";
import type { ConfirmCopy } from "../../ui/confirmCopy.ts";
import { checkPassword } from "../access/password.ts";

/** O mesmo piso da API (`PASSWORD_MIN_LENGTH`): conferido antes da chamada. */
export const PASSWORD_MIN_LENGTH = 8;

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter((part) => part !== "");
  if (parts.length === 0) return "?";
  const first = parts[0][0];
  const last = parts.length === 1 ? "" : parts[parts.length - 1][0];
  return (first + last).toUpperCase();
}

/**
 * Pelo ID da sessão, nunca pelo e-mail: e-mail é dado editável em outro
 * lugar, e comparar por ele deixaria a própria conta com botão de remover no
 * dia em que dois cadastros dividissem um endereço.
 */
export function isSelf(user: RestaurantUser, sessionUserId: string): boolean {
  return user.id === sessionUserId;
}

export function roleLabel(role: UserRole): string {
  return role === "owner" ? "Dono" : "Equipe";
}

export type InviteForm = {
  name: string;
  email: string;
  password: string;
  role: UserRole;
};

export type InviteErrors = Partial<Record<"name" | "email" | "password", string>>;

/**
 * O mínimo é checado aqui, com a frase própria do convite; o teto de 72
 * bytes do bcrypt é o mesmo `checkPassword` de `features/access/password.ts`
 * — duplicar aquela conta divergiria da regra real da API (S20) no dia em
 * que uma das duas mudasse sozinha.
 */
export function validateInvite(form: InviteForm): InviteErrors {
  const errors: InviteErrors = {};
  if (form.name.trim() === "") errors.name = "Diga o nome da pessoa.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errors.email = "Digite um e-mail válido.";
  if (form.password.length < PASSWORD_MIN_LENGTH) {
    errors.password = "A senha provisória precisa de pelo menos 8 caracteres.";
  } else {
    const problem = checkPassword(form.password);
    if (problem !== null) errors.password = problem;
  }
  return errors;
}

export function removeUserConfirm(name: string): ConfirmCopy {
  return {
    title: `Remover o acesso de ${name}?`,
    body: "A conta perde o acesso na hora, e a sessão aberta dela morre na próxima ação. Os pedidos que ela atendeu continuam no histórico.",
    cta: "Remover acesso",
    tone: "danger",
  };
}

/** A troca de papel só tem um destino: o outro. */
export function otherRole(role: UserRole): UserRole {
  return role === "owner" ? "staff" : "owner";
}

/**
 * Promover é o gesto de consequência: dá a alguém o poder de remover o
 * restaurante, por isso o tom de perigo. Rebaixar só tira.
 */
export function changeRoleConfirm(name: string, role: UserRole): ConfirmCopy {
  if (role === "owner") {
    return {
      title: `Tornar ${name} dono?`,
      body: "Dono administra os usuários e pode remover o restaurante. A mudança vale na próxima ação dela, sem entrar de novo.",
      cta: "Tornar dono",
      tone: "danger",
    };
  }
  return {
    title: `Tornar ${name} equipe?`,
    body: "A conta deixa de administrar os usuários e de poder remover o restaurante. O resto do painel continua igual, e a mudança vale na próxima ação dela.",
    cta: "Tornar equipe",
    tone: "accent",
  };
}
