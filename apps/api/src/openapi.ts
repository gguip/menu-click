import type { FastifyDynamicSwaggerOptions } from "@fastify/swagger";

/**
 * O documento OpenAPI da API.
 *
 * Quase tudo aqui é metadado: os schemas de entrada e de saída **não** são
 * escritos duas vezes. Toda rota do projeto já declara `schema` por obrigação
 * das regras F9/F10/S10, e é dele que o `@fastify/swagger` gera o documento —
 * o que também significa que o spec não tem como divergir do que a API faz.
 *
 * Isso vale como garantia e como armadilha: um campo esquecido no
 * `schema.response` some da documentação **e** da resposta, ao mesmo tempo.
 * Documentação errada aqui é sintoma de contrato errado, não de descuido na
 * escrita.
 */

/** Descrição de cada grupo de rotas, na ordem em que aparecem no `/docs`. */
export const OPENAPI_TAGS = [
  {
    name: "Cardápio público",
    description:
      "A superfície aberta: é para onde o QR code aponta. Não exige sessão, " +
      "e o que sai por aqui é decidido campo a campo — `stock` não aparece.",
  },
  {
    name: "Autenticação",
    description:
      "Cadastro, login e sessão do restaurante. A sessão é opaca e vive no " +
      "banco; o token viaja em `Authorization: Bearer`.",
  },
  {
    name: "Restaurantes",
    description:
      "Gestão do próprio restaurante. Pedir um restaurante que não é o da " +
      "sessão responde 404 — 403 confirmaria que ele existe.",
  },
  { name: "Produtos", description: "O cardápio, do lado de quem o edita." },
  {
    name: "Usuários",
    description:
      "Quem tem acesso ao painel. Restrito ao dono: administrar usuários é " +
      "uma das duas ações que o papel restringe — a outra é remover o " +
      "restaurante.",
  },
  {
    name: "Categorias",
    description:
      "As seções do cardápio. A ordem é a que o restaurante definir em " +
      "`position` — não a alfabética, porque cardápio segue a sequência da " +
      "refeição.",
  },
  {
    name: "Opções",
    description:
      "Os grupos de opções do cardápio — tamanho, sabores, adicionais. O " +
      "grupo pertence ao restaurante e se liga a vários produtos, porque " +
      '"Sabores" vale para todas as pizzas.',
  },
  {
    name: "Pedidos",
    description:
      "Criar um pedido é público (o cliente do QR não tem conta); listar, " +
      "confirmar e cancelar são do restaurante. A confirmação é o único " +
      "ponto do sistema que debita estoque.",
  },
  { name: "Operação", description: "Health check e afins." },
] as const;

export const openapiOptions: FastifyDynamicSwaggerOptions = {
  openapi: {
    openapi: "3.0.3",
    info: {
      title: "MenuClick API",
      version: "0.1.0",
      description: [
        "API do MenuClick — cardápio digital, QR code e delivery.",
        "",
        "## Duas superfícies",
        "",
        "A API atende dois públicos, e a diferença é o que mais importa ao usá-la:",
        "",
        "- **Quem escaneia o QR code** lê o cardápio e faz pedido, sem conta e sem token.",
        "- **O restaurante** faz todo o resto, com `Authorization: Bearer <token>`.",
        "",
        "**Toda rota exige sessão por padrão.** Ser pública é declaração explícita,",
        "e as poucas que são estão marcadas como tal aqui.",
        "",
        "## Convenções",
        "",
        "- Listagens respondem um envelope `{ data, limit, offset, total }`, nunca um array cru.",
        "  `limit` vai de 1 a 100 (default 20); fora da faixa é **400**, não ajuste silencioso.",
        "- Erro tem sempre a forma `{ statusCode, error, message }`.",
        "- Valores monetários são **inteiros em centavos**. Nunca float.",
        "- Nada é apagado: `DELETE` marca o registro como removido, e ele passa a se",
        "  comportar como se nunca tivesse existido (404 em tudo, fora das listagens).",
        "- Há limite de requisições por IP: 100/min no geral e **5/min no login**.",
        "  Estourar responde **429**.",
      ].join("\n"),
    },
    servers: [{ url: "http://localhost:3333", description: "Desenvolvimento" }],
    tags: [...OPENAPI_TAGS],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description:
            "O token devolvido por `POST /auth/login`. É opaco: não carrega " +
            "informação, e o servidor guarda só o hash dele.",
        },
      },
    },
  },

  /**
   * De onde sai a marcação de "esta rota exige sessão".
   *
   * Ela **não** é escrita à mão rota a rota: é derivada do mesmo
   * `config.public` que o hook de autenticação usa para decidir de verdade
   * (ver `routes/authenticate.ts`). Duas fontes divergiriam no primeiro
   * descuido, e uma documentação que mente sobre autenticação é pior que
   * documentação nenhuma.
   */
  transform: ({ schema, url, route }) => {
    const publica =
      (route as { config?: { public?: boolean } }).config?.public === true;

    return {
      url,
      schema: {
        ...schema,
        // `security: []` zera o requisito global só para as rotas públicas
        security: publica ? [] : [{ bearerAuth: [] }],
      },
    };
  },
};
