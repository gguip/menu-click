import { Button, NativeSelect, PasswordInput, Switch, TextInput } from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { login, register } from "../../api/auth.ts";
import { describeError } from "../../api/client.ts";
import { saveSession } from "../../api/session.ts";
import type { RegisterInput } from "../../api/types.ts";
import classes from "./access.module.css";
import { checkPassword } from "./password.ts";

const CUISINES = [
  "Pizzaria",
  "Italiana",
  "Hamburgueria",
  "Japonesa",
  "Brasileira",
  "Lanchonete",
  "Árabe",
  "Doceria",
  "Outra",
];

export type RegisterForm = {
  restaurantName: string;
  cuisineType: string;
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  zipCode: string;
  isTakeaway: boolean;
  isQrcode: boolean;
  isDelivery: boolean;
  userName: string;
  email: string;
  password: string;
};

// Entrega nasce DESLIGADA: a loja nova tem taxa fixa de R$ 0, e ligar entrega
// aqui seria entregar de graça para a cidade inteira. Liga-se na tela de
// Entrega, já com o frete configurado (spec, seção Acesso).
const INITIAL: RegisterForm = {
  restaurantName: "",
  cuisineType: "",
  street: "",
  number: "",
  neighborhood: "",
  city: "",
  state: "",
  zipCode: "",
  isTakeaway: true,
  isQrcode: true,
  isDelivery: false,
  userName: "",
  email: "",
  password: "",
};

const REQUIRED: [keyof RegisterForm, string][] = [
  ["restaurantName", "o nome da loja"],
  ["cuisineType", "o tipo de cozinha"],
  ["street", "a rua"],
  ["number", "o número"],
  ["neighborhood", "o bairro"],
  ["city", "a cidade"],
  ["state", "a UF"],
  ["zipCode", "o CEP"],
  ["userName", "seu nome"],
  ["email", "o e-mail"],
];

export function validateRegister(form: RegisterForm): string | null {
  for (const [field, label] of REQUIRED) {
    if (String(form[field]).trim() === "") return `Preencha ${label}.`;
  }
  const passwordProblem = checkPassword(form.password);
  if (passwordProblem) return passwordProblem;
  if (!form.isTakeaway && !form.isQrcode && !form.isDelivery) {
    return "Ligue ao menos uma modalidade — sem nenhuma, a loja não recebe pedido.";
  }
  return null;
}

export function toRegisterInput(form: RegisterForm): RegisterInput {
  return {
    restaurant: {
      name: form.restaurantName.trim(),
      cuisineType: form.cuisineType,
      address: {
        street: form.street.trim(),
        number: form.number.trim(),
        neighborhood: form.neighborhood.trim(),
        city: form.city.trim(),
        state: form.state.trim().toUpperCase(),
        zipCode: form.zipCode.trim(),
      },
      isDelivery: form.isDelivery,
      isTakeaway: form.isTakeaway,
      isQrcode: form.isQrcode,
    },
    user: { name: form.userName.trim(), email: form.email.trim(), password: form.password },
  };
}

export function RegisterPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<RegisterForm>(INITIAL);
  const [localError, setLocalError] = useState<string | null>(null);

  const set = <K extends keyof RegisterForm>(field: K, value: RegisterForm[K]) =>
    setForm((current) => ({ ...current, [field]: value }));

  const mutation = useMutation({
    mutationFn: async (input: RegisterInput) => {
      // O register responde 201 SEM token; o login em seguida é o que abre
      // a sessão. Se ele falhar, a loja já existe: manda para o login.
      await register(input);
      try {
        return await login(input.user.email, input.user.password);
      } catch {
        return null;
      }
    },
    onSuccess: (session) => {
      if (session === null) {
        navigate("/login?motivo=conta-criada", { replace: true });
        return;
      }
      saveSession(session);
      queryClient.clear();
      navigate("/confirme-seu-email", { replace: true });
    },
  });

  type TextField = Exclude<keyof RegisterForm, "isTakeaway" | "isQrcode" | "isDelivery">;
  const text = (field: TextField) => ({
    value: form[field],
    onChange: (event: { currentTarget: { value: string } }) => set(field, event.currentTarget.value),
  });

  return (
    <div className={classes.cardPage}>
      <div className={classes.card}>
        <Link to="/login" className={classes.link}>
          Voltar
        </Link>
        <p className={classes.eyebrow}>Painel da loja</p>
        <h1 className={classes.title}>Criar a conta da loja</h1>
        <p className={classes.subtitle}>
          O restaurante e o primeiro acesso são criados juntos. Quem criar a conta fica como dono.
        </p>
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            const problem = validateRegister(form);
            setLocalError(problem);
            if (problem === null) mutation.mutate(toRegisterInput(form));
          }}
        >
          <section className={classes.section}>
            <h2 className={classes.sectionTitle}>O restaurante</h2>
            <div className={classes.grid2}>
              <TextInput label="Nome da loja" placeholder="Trattoria Bella" {...text("restaurantName")} />
              <NativeSelect
                label="Tipo de cozinha"
                data={[{ value: "", label: "Escolha" }, ...CUISINES]}
                {...text("cuisineType")}
              />
            </div>
          </section>

          <section className={classes.section}>
            <h2 className={classes.sectionTitle}>Endereço e modalidades</h2>
            <TextInput label="Rua" {...text("street")} />
            <div className={classes.grid2}>
              <TextInput label="Número" {...text("number")} />
              <TextInput label="Bairro" {...text("neighborhood")} />
            </div>
            <div className={classes.grid3}>
              <TextInput label="Cidade" {...text("city")} />
              <TextInput label="UF" maxLength={2} {...text("state")} />
              <TextInput label="CEP" {...text("zipCode")} />
            </div>
            <Switch
              label="Retirada no balcão"
              description="O cliente busca no endereço da loja"
              aria-label="Retirada no balcão"
              checked={form.isTakeaway}
              onChange={(event) => set("isTakeaway", event.currentTarget.checked)}
            />
            <Switch
              label="Salão"
              description="Pedido pela mesa, com QR code"
              aria-label="Salão"
              checked={form.isQrcode}
              onChange={(event) => set("isQrcode", event.currentTarget.checked)}
            />
            <Switch
              label="Entrega"
              description="Ligue depois, na tela de Entrega, junto com o frete. Ligada agora, a entrega sairia de graça."
              aria-label="Entrega"
              checked={form.isDelivery}
              onChange={(event) => set("isDelivery", event.currentTarget.checked)}
            />
          </section>

          <section className={classes.section}>
            <h2 className={classes.sectionTitle}>Seu acesso</h2>
            <TextInput label="Seu nome" placeholder="Cláudia Mendes" {...text("userName")} />
            <TextInput
              label="E-mail"
              type="email"
              placeholder="gerencia@sualoja.com.br"
              description="É para cá que vai o link de confirmação, e não há como trocar depois pelo painel. Confira antes de criar."
              {...text("email")}
            />
            <PasswordInput label="Senha" placeholder="mínimo 8 caracteres" {...text("password")} />
          </section>

          {localError && (
            <p role="alert" className={classes.error}>
              {localError}
            </p>
          )}
          {mutation.isError && (
            <p role="alert" className={classes.error}>
              {describeError(mutation.error)}
            </p>
          )}
          <Button type="submit" fullWidth h={46} fz={15} mt={12} loading={mutation.isPending}>
            Criar loja e continuar
          </Button>
        </form>
        <p className={classes.footnote}>
          Já tem conta?{" "}
          <Link to="/login" className={classes.link}>
            Entrar
          </Link>
        </p>
      </div>
    </div>
  );
}
