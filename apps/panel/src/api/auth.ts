import { apiRequest } from "./client.ts";
import type { LoginResponse, Me, RegisterInput } from "./types.ts";

type Message = { message: string };

export function login(email: string, password: string): Promise<LoginResponse> {
  return apiRequest<LoginResponse>("/auth/login", {
    method: "POST",
    body: { email, password },
    auth: false,
  });
}

/** Responde 201 SEM token: quem chama faz o login em seguida. */
export function register(input: RegisterInput): Promise<unknown> {
  return apiRequest<unknown>("/auth/register", { method: "POST", body: input, auth: false });
}

export function fetchMe(): Promise<Me> {
  return apiRequest<Me>("/auth/me");
}

export function logout(): Promise<void> {
  return apiRequest<void>("/auth/logout", { method: "POST" });
}

export function resendVerification(): Promise<Message> {
  return apiRequest<Message>("/auth/resend-verification", { method: "POST" });
}

export function verifyEmail(token: string): Promise<Message> {
  return apiRequest<Message>("/auth/verify-email", {
    method: "POST",
    body: { token },
    auth: false,
  });
}

export function forgotPassword(email: string): Promise<Message> {
  return apiRequest<Message>("/auth/forgot-password", {
    method: "POST",
    body: { email },
    auth: false,
  });
}

export function resetPassword(token: string, newPassword: string): Promise<Message> {
  return apiRequest<Message>("/auth/reset-password", {
    method: "POST",
    body: { token, newPassword },
    auth: false,
  });
}
