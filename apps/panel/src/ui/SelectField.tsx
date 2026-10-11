import { Select, type SelectProps } from "@mantine/core";

/** O `Select` do Mantine trata `""` como "nada escolhido"; a opção vazia viaja com este valor. */
const EMPTY = "__vazio__";
const encode = (value: string) => (value === "" ? EMPTY : value);
const decode = (value: string | null) => (value === null || value === EMPTY ? "" : value);

type Passthrough = Pick<
  SelectProps,
  | "label"
  | "description"
  | "placeholder"
  | "className"
  | "classNames"
  | "inputWrapperOrder"
  | "searchable"
  | "aria-label"
  | "w"
>;

/**
 * Caixa de escolha do painel: a lista aberta é desenhada pelo Mantine, e não
 * pelo navegador, como no `<select>` nativo.
 *
 * Fala `string` nos dois sentidos, como o `<select>`: `""` é uma opção como
 * outra qualquer ("Sem seção", "Todas as mesas"). Valor fora de `data` deixa o
 * campo no `placeholder` — é assim que funciona a caixa de "adicionar".
 */
export function SelectField({
  data,
  value,
  onChange,
  ...rest
}: Passthrough & {
  data: readonly { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  const known = data.some((option) => option.value === value);
  return (
    <Select
      {...rest}
      data={data.map((option) => ({ value: encode(option.value), label: option.label }))}
      value={known ? encode(value) : null}
      onChange={(next) => {
        if (next !== null) onChange(decode(next));
      }}
      allowDeselect={false}
      // sem sombra, como o resto do painel: quem separa a lista é a borda
      comboboxProps={{ shadow: "none" }}
      // o valor de verdade, para quem lê o campo sem abrir a lista (testes)
      data-value={known ? value : ""}
    />
  );
}
