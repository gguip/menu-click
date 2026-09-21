import { Navigate, type RouteObject } from "react-router";
import { RedirectIfSession, RequireSession, RequireVerified } from "./auth/guards.tsx";
import { EmailBlockedPage } from "./features/access/EmailBlockedPage.tsx";
import { ForgotPasswordPage } from "./features/access/ForgotPasswordPage.tsx";
import { LoginPage } from "./features/access/LoginPage.tsx";
import { RegisterPage } from "./features/access/RegisterPage.tsx";
import { ResetPasswordPage } from "./features/access/ResetPasswordPage.tsx";
import { VerifyEmailLinkPage } from "./features/access/VerifyEmailLinkPage.tsx";
import { CategoriesPage } from "./features/categories/CategoriesPage.tsx";
import { OrderDrawer } from "./features/orders/OrderDrawer.tsx";
import { OrdersPage } from "./features/orders/OrdersPage.tsx";
import { ProductFormPage } from "./features/products/ProductFormPage.tsx";
import { ProductsPage } from "./features/products/ProductsPage.tsx";
import { ModalitiesPage } from "./features/settings/ModalitiesPage.tsx";
import { PanelLayout } from "./layout/PanelLayout.tsx";
import { RouteError } from "./layout/RouteError.tsx";

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
      { path: "/confirme-seu-email", element: <EmailBlockedPage /> },
      {
        element: <RequireVerified />,
        children: [
          {
            element: <PanelLayout />,
            // Sem isto, um throw em qualquer tela do shell (columnOf com
            // status desconhecido, useSessionUser fora de guarda, qualquer
            // bug de render) derrubava a árvore inteira numa tela branca
            // (FIX 6 da revisão).
            errorElement: <RouteError />,
            children: [
              {
                path: "/pedidos",
                handle: { title: "Pedidos" },
                element: <OrdersPage />,
                children: [{ path: ":orderId", element: <OrderDrawer /> }],
              },
              { path: "/produtos", handle: { title: "Produtos" }, element: <ProductsPage /> },
              { path: "/produtos/novo", handle: { title: "Novo produto" }, element: <ProductFormPage /> },
              { path: "/produtos/:productId", handle: { title: "Editar produto" }, element: <ProductFormPage /> },
              { path: "/secoes", handle: { title: "Seções do cardápio" }, element: <CategoriesPage /> },
              {
                path: "/modalidades",
                handle: { title: "Modalidades e pagamento" },
                element: <ModalitiesPage />,
              },
            ],
          },
        ],
      },
    ],
  },
  { path: "*", element: <Navigate to="/pedidos" replace /> },
];
