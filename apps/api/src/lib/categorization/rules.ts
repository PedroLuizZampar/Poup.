/**
 * Tabela de palavras-chave usada para adivinhar a categoria de uma transação
 * importada.
 *
 * É palpite, e envelhece: o usuário cria as próprias categorias, e uma regra só
 * vale se existir uma categoria com aquele nome. Está isolada aqui — em vez de
 * misturada ao código de sync — justamente para que dê para mexer sem tocar na
 * importação, e para que um dia possa vir de uma tabela `CategoryRule` que a UI
 * edite.
 *
 * `targetName` casa com o nome da categoria do usuário, sem diferenciar caixa.
 * Regra sem categoria correspondente é simplesmente ignorada.
 */

export interface CategorizationRule {
  /** Trechos procurados na descrição e na categoria vinda da Pluggy. */
  keywords: string[];
  /** Nome da categoria do usuário para onde a regra aponta. */
  targetName: string;
}

export const CATEGORIZATION_RULES: CategorizationRule[] = [
  {
    targetName: "Mercado",
    keywords: [
      "mercado",
      "supermercado",
      "carrefour",
      "pão de açúcar",
      "assai",
      "extra",
      "hortifruti",
      "atacadão",
      "sacolão",
      "groceries",
    ],
  },
  {
    targetName: "Restaurante",
    keywords: [
      "restaurante",
      "ifood",
      "uber eats",
      "rappi",
      "burger",
      "mcdonald",
      "pizza",
      "padaria",
      "bar",
      "lanche",
      "café",
      "starbucks",
      "food & drink",
    ],
  },
  {
    targetName: "Transporte",
    keywords: [
      "uber",
      "99",
      "combustível",
      "gasolina",
      "posto",
      "ipiranga",
      "shell",
      "estacionamento",
      "pedágio",
      "transporte",
      "transport",
      "metrô",
      "bilhete único",
    ],
  },
  {
    targetName: "Serviços",
    keywords: [
      "netflix",
      "spotify",
      "amazon prime",
      "youtube",
      "hbo",
      "max",
      "disney",
      "apple",
      "globo play",
      "assinatura",
      "subscription",
    ],
  },
  {
    targetName: "Saúde",
    keywords: [
      "farmácia",
      "droga",
      "drogaria",
      "médico",
      "hospital",
      "laboratório",
      "saúde",
      "health",
      "consulta",
      "unimed",
    ],
  },
  {
    targetName: "Lazer",
    keywords: [
      "cinema",
      "ingresso",
      "show",
      "teatro",
      "jogos",
      "steam",
      "playstation",
      "lazer",
      "entertainment",
    ],
  },
  {
    targetName: "Renda",
    keywords: [
      "salário",
      "proventos",
      "ted recebida",
      "pix recebido",
      "remuneração",
      "renda",
      "income",
      "salary",
    ],
  },
  {
    targetName: "Moradia",
    keywords: [
      "aluguel",
      "condomínio",
      "enel",
      "sabesp",
      "cpfl",
      "energia",
      "luz",
      "água",
      "gás",
      "moradia",
      "housing",
      "iptu",
    ],
  },
  {
    targetName: "Casa",
    keywords: ["leroy", "tok&stok", "mobly", "móveis", "casa", "decor"],
  },
  {
    targetName: "Eletrônicos",
    keywords: ["kabum", "pichau", "apple store", "dell", "samsung", "eletrônicos", "electronics"],
  },
];
