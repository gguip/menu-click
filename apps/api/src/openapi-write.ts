import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app.ts";

/**
 * Escreve o `openapi.json` a partir da app de verdade.
 *
 * O documento é **derivado**, nunca editado à mão: ele sai dos mesmos
 * `schema` que validam as requisições e serializam as respostas. Editar o JSON
 * seria criar uma segunda verdade que a primeira mudança de rota já
 * desmentiria.
 *
 * O arquivo é versionado por dois motivos: o front gera tipos a partir dele sem
 * precisar da API de pé, e mudança de contrato **aparece no diff do PR** — que
 * é onde ela precisa ser vista. O CI roda este script e falha se o resultado
 * diferir do que está commitado.
 *
 * Não toca no banco: `app.ready()` só carrega plugins e rotas, e o pool do `pg`
 * conecta preguiçosamente (a primeira query é que abre conexão). Por isso o
 * script roda em CI sem Postgres.
 */
const DESTINO = fileURLToPath(new URL("../openapi.json", import.meta.url));

const app = await buildApp();
await app.ready();

const documento = app.swagger();
await writeFile(DESTINO, `${JSON.stringify(documento, null, 2)}\n`, "utf8");

await app.close();
console.log(`openapi.json escrito (${Object.keys(documento.paths ?? {}).length} rotas)`);
