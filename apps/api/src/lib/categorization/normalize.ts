/**
 * Reduzir a descrição de extrato ao nome do comerciante.
 *
 * Um extrato brasileiro carrega tudo menos o que interessa: bandeira, forma de
 * pagamento, parcela, id da maquininha, cidade. Duas compras no mesmo lugar
 * chegam como textos diferentes, e é por isso que casar descrição crua contra
 * descrição crua não funciona. O que sobra depois daqui é o que dá para comparar.
 */

/** Termos que aparecem em toda descrição e não distinguem ninguém. */
const STOPWORDS = new Set([
  "compra",
  "cartao",
  "debito",
  "credito",
  "pagamento",
  "pag",
  "conta",
]);

export function normalizeDescription(raw: string): string {
  const withoutAccents = raw
    .normalize("NFD")
    // A faixa combinante do Unicode, escrita por código para que o arquivo não
    // dependa de como o editor salva um acento solto.
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  const cleaned = withoutAccents
    // parcelamento: "parc 03/12", "3/12"
    .replace(/\bparc\s*\d{1,2}\s*\/\s*\d{1,2}\b/g, " ")
    .replace(/\b\d{1,2}\s*\/\s*\d{1,2}(\s*\/\s*\d{2,4})?\b/g, " ")
    // ids e valores: qualquer corrida de três dígitos ou mais
    .replace(/\d{3,}/g, " ")
    // pontuação de extrato
    .replace(/[*#|.,;:()\[\]/\_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned
    .split(" ")
    .filter((token) => token.length > 0 && !STOPWORDS.has(token))
    .join(" ");
}

/**
 * Os três primeiros tokens normalizados. É o suficiente para separar "IFOOD IFD
 * SAO" de "UBER TRIP", e curto o bastante para que a cidade e o id do fim da
 * linha não impeçam duas compras no mesmo lugar de casarem.
 */
export function merchantKey(raw: string): string | null {
  const key = normalizeDescription(raw).split(" ").slice(0, 3).join(" ").trim();
  if (key.length < 3) return null;
  // Sem nenhuma letra sobrou só o que a normalização não teve como limpar —
  // números curtos de agência, terminal, parcela. Isso não é um comerciante, e
  // indexá-lo casaria transações que só têm em comum um id parecido.
  if (!/[a-z]/.test(key)) return null;
  return key;
}
