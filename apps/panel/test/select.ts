import { fireEvent, screen, waitFor } from "@testing-library/react";

/**
 * O campo de um `SelectField`. O rótulo nomeia DOIS elementos — a caixa e a
 * lista de opções —, então `getByLabelText` sozinho acha os dois.
 */
export function selectField(label: string): HTMLInputElement {
  const field = screen.getAllByLabelText(label).find((element) => element.tagName === "INPUT");
  if (field === undefined) throw new Error(`não há caixa de escolha "${label}"`);
  return field as HTMLInputElement;
}

export async function findSelectField(label: string): Promise<HTMLInputElement> {
  await screen.findAllByLabelText(label);
  return selectField(label);
}

/** Escolhe, pelo VALOR, uma opção de um `SelectField` — abre a lista e clica. */
export function chooseOption(labelOrField: string | HTMLElement, value: string): void {
  const field = typeof labelOrField === "string" ? selectField(labelOrField) : labelOrField;
  fireEvent.click(field);
  const wanted = value === "" ? "__vazio__" : value;
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (candidate) => candidate.getAttribute("value") === wanted,
  );
  if (option === undefined) throw new Error(`opção "${value}" não está na lista`);
  fireEvent.click(option);
}

/**
 * O mesmo, para lista que ainda está chegando da API: espera a caixa existir,
 * abre uma vez só (o segundo clique fecharia) e espera a opção aparecer.
 */
export async function chooseOptionWhenLoaded(label: string, value: string): Promise<void> {
  const field = await findSelectField(label);
  fireEvent.click(field);
  const wanted = value === "" ? "__vazio__" : value;
  const option = await waitFor(() => {
    const found = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (candidate) => candidate.getAttribute("value") === wanted,
    );
    if (found === undefined) throw new Error(`opção "${value}" não está na lista`);
    return found;
  });
  fireEvent.click(option);
}

/** O valor escolhido num `SelectField`. */
export function chosenValue(field: HTMLElement): string {
  return field.getAttribute("data-value") ?? "";
}
