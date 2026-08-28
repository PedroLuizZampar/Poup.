/**
 * O nome de categoria reduzido ao que serve para dizer "e a mesma coisa".
 *
 * Deliberadamente mais tímida que a `normalizeDescription` da categorizacao:
 * aquela derruba stopwords de extrato, e "Conta de Luz" viraria "luz". Aqui o
 * unico ruido e acento, caixa e espaco.
 */
export function normalizeCategoryName(raw: string): string {
  return raw
    .normalize("NFD")
    // A faixa combinante do Unicode, escrita por codigo pela mesma razao que em
    // `lib/categorization/normalize.ts`: para o arquivo nao depender de como o
    // editor salva um acento solto.
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
