interface ImportMetaEnv {
  /** Base da API. Default `/api` (o proxy do Vite no dev). */
  readonly VITE_API_URL?: string;
  /** Link do suporte na tela de bloqueio. Sem ele, o botão não aparece. */
  readonly VITE_SUPPORT_URL?: string;
}
