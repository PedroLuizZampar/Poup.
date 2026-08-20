import type { Account } from "pluggy-sdk";

/**
 * Nome de instituição e nome de conta, a partir do que a Pluggy devolve.
 *
 * A regra de precedência é: **o conector manda**. Ele é quem sabe com qual
 * banco a conexão foi feita, e é dado, não palpite. A tabela abaixo só entra
 * quando o conector é genérico (o sandbox "MeuPluggy", por exemplo) ou quando
 * uma conta do item veio de outro banco — situação em que o código COMPE do
 * `transferNumber` é a informação mais confiável disponível.
 *
 * Isto vivia em `pluggy.service.ts` como `if`s encadeados. Virou tabela porque
 * acrescentar um banco tem que ser acrescentar uma linha.
 */

interface InstitutionEntry {
  name: string;
  /** Código COMPE do banco (os 3 primeiros dígitos do `transferNumber`). */
  compe?: string;
  /** Pedaços de nome que identificam a instituição, em caixa alta. */
  aliases: string[];
}

const INSTITUTIONS: InstitutionEntry[] = [
  { name: "Banco Inter", compe: "077", aliases: ["INTER"] },
  { name: "Caixa Econômica Federal", compe: "104", aliases: ["CAIXA"] },
  { name: "Nubank", compe: "260", aliases: ["NUBANK", "NU PAGAMENTOS"] },
  { name: "Itaú", compe: "341", aliases: ["ITAU", "ITAÚ"] },
  { name: "Bradesco", compe: "237", aliases: ["BRADESCO"] },
  { name: "Santander", compe: "033", aliases: ["SANTANDER"] },
  { name: "C6 Bank", compe: "336", aliases: ["C6"] },
  { name: "Banco do Brasil", compe: "001", aliases: ["BANCO DO BRASIL"] },
  { name: "BTG Pactual", compe: "208", aliases: ["BTG"] },
  { name: "Banco Original", compe: "212", aliases: ["ORIGINAL"] },
  { name: "PagBank", compe: "290", aliases: ["PAGSEGURO", "PAGBANK"] },
  { name: "Mercado Pago", compe: "323", aliases: ["MERCADO PAGO"] },
  { name: "Banco Safra", compe: "422", aliases: ["SAFRA"] },
  { name: "Sicredi", compe: "748", aliases: ["SICREDI"] },
  { name: "Sicoob", compe: "756", aliases: ["SICOOB"] },
  { name: "XP Investimentos", compe: "102", aliases: ["XP"] },
  { name: "Rico", aliases: ["RICO"] },
  { name: "Banco Neon", compe: "735", aliases: ["NEON"] },
  { name: "Will Bank", compe: "280", aliases: ["WILL BANK"] },
];

/** Nome que o conector devolve quando não diz nada de útil. */
const GENERIC_CONNECTOR_NAMES = new Set(["MEUPLUGGY", "INSTITUIÇÃO FINANCEIRA", "OUTROS", ""]);

/**
 * Faixa do cartão, não nome de banco. A Pluggy costuma mandar isso como `name`
 * da conta de crédito, e sem a lista o app acabava com uma "instituição"
 * chamada Platinum.
 */
const CARD_TIERS = new Set([
  "GOLD",
  "PLATINUM",
  "BLACK",
  "STANDARD",
  "INFINITE",
  "SIGNATURE",
  "CLASSIC",
  "INTERNACIONAL",
  "NACIONAL",
]);

export const FALLBACK_INSTITUTION_NAME = "Instituição Financeira";

function isGeneric(name: string | null | undefined): boolean {
  if (!name) return true;
  return GENERIC_CONNECTOR_NAMES.has(name.trim().toUpperCase());
}

/** Procura na tabela pelo código COMPE do `transferNumber` (ex.: "077-1234"). */
function matchByCompe(transferNumber: string | null | undefined): string | null {
  const digits = (transferNumber ?? "").replace(/\D/g, "");
  if (digits.length < 3) return null;
  const compe = digits.slice(0, 3);
  return INSTITUTIONS.find((i) => i.compe === compe)?.name ?? null;
}

/** Procura na tabela por um alias contido no nome. */
function matchByName(rawName: string | null | undefined): string | null {
  const name = (rawName ?? "").toUpperCase();
  if (!name) return null;
  return INSTITUTIONS.find((i) => i.aliases.some((alias) => name.includes(alias)))?.name ?? null;
}

/**
 * Nome da instituição de uma conta. `connectorName` é o nome do conector do
 * item — a fonte primária — e só é descartado quando o COMPE da conta aponta
 * para outro banco ou quando o conector é genérico.
 */
export function resolveAccountInstitution(
  account: Pick<Account, "name" | "bankData">,
  connectorName?: string | null
): string {
  const byCompe = matchByCompe(account.bankData?.transferNumber);
  if (byCompe) return byCompe;

  if (!isGeneric(connectorName)) return connectorName!.trim();

  const byName = matchByName(account.name);
  if (byName) return byName;

  const accountName = (account.name ?? "").trim();
  if (accountName && !CARD_TIERS.has(accountName.toUpperCase())) {
    return accountName;
  }

  return FALLBACK_INSTITUTION_NAME;
}

/**
 * Nome da instituição do item. Usa o conector; se ele for genérico, tenta
 * deduzir pelas contas importadas.
 */
export function resolveItemInstitution(
  accounts: Array<Pick<Account, "name" | "bankData">>,
  connectorName?: string | null
): string {
  if (!isGeneric(connectorName)) return connectorName!.trim();

  for (const account of accounts) {
    const detected = resolveAccountInstitution(account, null);
    if (detected !== FALLBACK_INSTITUTION_NAME) return detected;
  }

  return FALLBACK_INSTITUTION_NAME;
}

/**
 * Nome exibido da conta: "Nubank - Conta Corrente", "Itaú - Cartão Visa
 * Platinum". O usuário pode sobrescrever isso em `Account.customName`.
 */
export function formatAccountName(
  account: Pick<Account, "name" | "type" | "subtype" | "creditData">,
  institutionName: string
): string {
  const rawName = (account.name ?? "").trim();
  const type = String(account.type ?? "").toUpperCase();
  const subtype = String(account.subtype ?? "").toUpperCase();

  if (type === "CREDIT" || subtype === "CREDIT_CARD") {
    const level = account.creditData?.level || rawName;
    const brand = account.creditData?.brand || "";
    const cardTitle = [brand, level].filter(Boolean).join(" ").trim();
    return `${institutionName} - Cartão ${cardTitle || "de Crédito"}`.trim();
  }

  if (subtype === "SAVINGS_ACCOUNT") return `${institutionName} - Poupança`;
  if (subtype === "CHECKING_ACCOUNT") return `${institutionName} - Conta Corrente`;
  if (type === "INVESTMENT" || subtype === "INVESTMENT_ACCOUNT") {
    return `${institutionName} - Investimentos`;
  }

  return rawName ? `${institutionName} - ${rawName}` : institutionName;
}
