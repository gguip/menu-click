import { Button, PasswordInput, Select, TextInput } from "@mantine/core";
import { type FormEvent, useState } from "react";
import { describeError } from "../../api/client.ts";
import type { RestaurantUser, UserRole } from "../../api/types.ts";
import { useSessionUser } from "../../auth/useMe.ts";
import buttons from "../../ui/buttons.module.css";
import { ConfirmDialog } from "../../ui/ConfirmDialog.tsx";
import { Notice } from "../../ui/Notice.tsx";
import {
  initials,
  type InviteErrors,
  type InviteForm,
  isSelf,
  removeUserConfirm,
  roleLabel,
  validateInvite,
} from "./users.ts";
import classes from "./UsersPage.module.css";
import { useInviteUser, useRemoveUser, useUsersList } from "./useUsers.ts";

const EMPTY: InviteForm = { name: "", email: "", password: "", role: "staff" };

function UserRow({
  restaurantId,
  user,
  self,
  onFail,
}: {
  restaurantId: string;
  user: RestaurantUser;
  self: boolean;
  onFail: (message: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const remove = useRemoveUser(restaurantId, user.id);

  return (
    <li className={classes.row}>
      <span className={classes.avatar} aria-hidden="true">
        {initials(user.name)}
      </span>
      <div className={classes.info}>
        <span className={classes.name}>{user.name}</span>
        <span className={classes.email}>{user.email}</span>
      </div>
      <span
        className={
          user.role === "owner" ? `${classes.badge} ${classes.badgeOwner}` : classes.badge
        }
      >
        {roleLabel(user.role)}
      </span>
      {self ? (
        <span className={classes.self}>você</span>
      ) : (
        <Button
          variant="subtle"
          className={buttons.dangerText}
          aria-label={`Remover ${user.name}`}
          onClick={() => setConfirming(true)}
        >
          Remover
        </Button>
      )}
      <ConfirmDialog
        copy={confirming ? removeUserConfirm(user.name) : null}
        busy={remove.isPending}
        onClose={() => setConfirming(false)}
        onConfirm={() =>
          remove.mutate(undefined, {
            onSuccess: () => setConfirming(false),
            onError: (cause) => {
              setConfirming(false);
              onFail(describeError(cause));
            },
          })
        }
      />
    </li>
  );
}

export function UsersPage() {
  const me = useSessionUser();
  const owner = me.role === "owner";
  const users = useUsersList(me.restaurantId, owner);
  const [form, setForm] = useState<InviteForm>(EMPTY);
  const [errors, setErrors] = useState<InviteErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const invite = useInviteUser(me.restaurantId);

  if (!owner) {
    return (
      <div className={classes.page}>
        <Notice tone="accent" title="Usuários">
          Só o dono administra os usuários da loja.
        </Notice>
      </div>
    );
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setFailure(null);
    const problems = validateInvite(form);
    setErrors(problems);
    if (Object.keys(problems).length > 0) return;
    invite.mutate(
      { name: form.name.trim(), email: form.email.trim(), password: form.password, role: form.role },
      {
        onSuccess: () => setForm(EMPTY),
        onError: (cause) => setFailure(describeError(cause)),
      },
    );
  };

  return (
    <div className={classes.page}>
      <p className={classes.note}>
        Dono e equipe operam o painel do mesmo jeito. A diferença é só esta tela e a remoção do
        restaurante.
      </p>
      {users.isError && users.data === undefined && (
        <Notice tone="danger" title="Não foi possível carregar os usuários">
          {describeError(users.error)}
        </Notice>
      )}
      <section className={classes.card}>
        <ul className={classes.list}>
          {(users.data ?? []).map((user) => (
            <UserRow
              key={user.id}
              restaurantId={me.restaurantId}
              user={user}
              self={isSelf(user, me.id)}
              onFail={setFailure}
            />
          ))}
        </ul>
        <form className={classes.invite} onSubmit={submit}>
          <div className={classes.fields}>
            <TextInput
              label="Nome"
              value={form.name}
              error={errors.name}
              onChange={(event) => setForm({ ...form, name: event.currentTarget.value })}
            />
            <TextInput
              label="E-mail"
              type="email"
              value={form.email}
              error={errors.email}
              onChange={(event) => setForm({ ...form, email: event.currentTarget.value })}
            />
            <PasswordInput
              label="Senha provisória"
              description="Você entrega esta senha à pessoa. Ela troca depois, no menu da conta."
              value={form.password}
              error={errors.password}
              onChange={(event) => setForm({ ...form, password: event.currentTarget.value })}
            />
            <Select
              label="Papel"
              data={[
                { value: "staff", label: "Equipe" },
                { value: "owner", label: "Dono" },
              ]}
              value={form.role}
              allowDeselect={false}
              onChange={(value) => setForm({ ...form, role: (value ?? "staff") as UserRole })}
            />
          </div>
          <div>
            <Button type="submit" loading={invite.isPending}>
              Convidar
            </Button>
          </div>
        </form>
      </section>
      <p className={classes.note}>
        O papel é escolhido no convite. Para trocar, remova a pessoa e convide de novo.
      </p>
      <p className={classes.note}>
        Sem papel informado, o usuário nasce como equipe. Ninguém remove a própria conta.
      </p>
      {failure && (
        <p role="alert" className={classes.error}>
          {failure}
        </p>
      )}
    </div>
  );
}
