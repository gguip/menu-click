import { Navigate, type RouteObject } from "react-router";
import { RedirectIfSession, RequireSession, RequireVerified } from "./auth/guards.tsx";
import { ForgotPasswordPage } from "./features/access/ForgotPasswordPage.tsx";
import { LoginPage } from "./features/access/LoginPage.tsx";
import { RegisterPage } from "./features/access/RegisterPage.tsx";
import { ResetPasswordPage } from "./features/access/ResetPasswordPage.tsx";
import { VerifyEmailLinkPage } from "./features/access/VerifyEmailLinkPage.tsx";

// Provisório: cada tela entra no lugar do seu Placeholder na task dela.
function Placeholder({ title }: { title: string }) {
  return <h1>{title}</h1>;
}

export const routes: RouteObject[] = [
  {
    element: <RedirectIfSession />,
    children: [
      { path: "/login", element: <LoginPage /> },
      { path: "/cadastro", element: <RegisterPage /> },
      { path: "/esqueci-senha", element: <ForgotPasswordPage /> },
    ],
  },
  // Os dois links que a API manda por e-mail (PASSWORD_RESET_URL e
  // EMAIL_VERIFICATION_URL) — funcionam com ou sem sessão.
  { path: "/recuperar-senha", element: <ResetPasswordPage /> },
  { path: "/verificar-email", element: <VerifyEmailLinkPage /> },
  {
    element: <RequireSession />,
    children: [
      { path: "/confirme-seu-email", element: <Placeholder title="Confirme o e-mail da loja" /> },
      {
        element: <RequireVerified />,
        children: [{ path: "/pedidos", element: <Placeholder title="Pedidos" /> }],
      },
    ],
  },
  { path: "*", element: <Navigate to="/pedidos" replace /> },
];
