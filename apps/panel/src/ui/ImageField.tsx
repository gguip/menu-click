import { Button, Input } from "@mantine/core";
import { useRef, useState } from "react";
import { imageUrl } from "../lib/image.ts";
import { ACCEPTED_IMAGE_TYPES, type ImageChange, KEEP, validateImageFile } from "../lib/upload.ts";
import buttons from "./buttons.module.css";
import classes from "./ImageField.module.css";

/**
 * Campo de imagem de um formulário: prévia, escolher/trocar e remover.
 *
 * NÃO envia nada. Ele só conta ao formulário o que a pessoa fez (`onChange`);
 * quem envia é o salvar. A troca sobrescreve o mesmo endereço no Cloudinary,
 * então subir ao escolher mudaria o cardápio antes de a pessoa confirmar — e
 * "Cancelar" não teria como desfazer.
 */
export function ImageField({
  label,
  description,
  saved,
  change,
  onChange,
  shape = "square",
}: {
  label: string;
  description?: string;
  /** A URL que está salva hoje, se houver. */
  saved: string | undefined;
  change: ImageChange;
  onChange: (change: ImageChange) => void;
  shape?: "square" | "wide";
}) {
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const shown =
    change.kind === "replace"
      ? change.previewUrl
      : change.kind === "remove" || saved === undefined
        ? null
        : imageUrl(saved, 400);

  /** A prévia local segura memória até ser liberada. */
  const releasePreview = () => {
    if (change.kind === "replace") URL.revokeObjectURL(change.previewUrl);
  };

  const pick = (file: File | undefined) => {
    if (file === undefined) return;
    const found = validateImageFile(file);
    setProblem(found);
    if (found !== null) return;
    releasePreview();
    onChange({ kind: "replace", file, previewUrl: URL.createObjectURL(file) });
  };

  const remove = () => {
    setProblem(null);
    releasePreview();
    // sem nada salvo, "remover" a imagem recém-escolhida é só desistir dela
    onChange(saved === undefined ? KEEP : { kind: "remove" });
  };

  return (
    // `labelElement="div"`: o rótulo descreve o grupo; o controle com nome é o
    // `input` de arquivo, pelo `aria-label`
    <Input.Wrapper label={label} labelElement="div" description={description} error={problem}>
      <div className={classes.row}>
        <div className={`${classes.preview} ${classes[shape]}`}>
          {shown === null ? "Sem imagem" : <img src={shown} alt="" />}
        </div>
        <div className={classes.actions}>
          <Button
            variant="default"
            size="xs"
            aria-label={`${shown === null ? "Escolher" : "Trocar"} ${label}`}
            onClick={() => input.current?.click()}
          >
            {shown === null ? "Escolher imagem" : "Trocar"}
          </Button>
          {shown !== null && (
            <Button
              variant="subtle"
              size="xs"
              className={buttons.dangerText}
              aria-label={`Remover ${label}`}
              onClick={remove}
            >
              Remover
            </Button>
          )}
        </div>
      </div>
      <input
        ref={input}
        type="file"
        hidden
        aria-label={label}
        accept={ACCEPTED_IMAGE_TYPES.join(",")}
        onChange={(event) => {
          pick(event.currentTarget.files?.[0]);
          // sem isto, escolher de novo o mesmo arquivo não dispara `change`
          event.currentTarget.value = "";
        }}
      />
    </Input.Wrapper>
  );
}
