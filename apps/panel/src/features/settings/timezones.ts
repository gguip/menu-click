/**
 * Lista fechada: o Postgres aceita nomes IANA e apelidos, mas texto livre aqui
 * só serviria para digitar um nome que ele recusa. São os fusos do Brasil.
 */
export const TIMEZONES: readonly { value: string; label: string }[] = [
  { value: "America/Sao_Paulo", label: "Brasília (America/Sao_Paulo)" },
  { value: "America/Bahia", label: "Bahia (America/Bahia)" },
  { value: "America/Fortaleza", label: "Ceará (America/Fortaleza)" },
  { value: "America/Recife", label: "Pernambuco (America/Recife)" },
  { value: "America/Belem", label: "Pará (America/Belem)" },
  { value: "America/Manaus", label: "Amazonas (America/Manaus)" },
  { value: "America/Cuiaba", label: "Mato Grosso (America/Cuiaba)" },
  { value: "America/Porto_Velho", label: "Rondônia (America/Porto_Velho)" },
  { value: "America/Rio_Branco", label: "Acre (America/Rio_Branco)" },
  { value: "America/Noronha", label: "Fernando de Noronha (America/Noronha)" },
];
