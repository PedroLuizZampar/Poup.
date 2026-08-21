import { formatCurrency } from "../../lib/format";

interface MoneyProps {
  value: number;
  /** Prefixa "+"/"−", como em listas onde receita e despesa convivem. */
  showSign?: boolean;
  /** Colado antes do valor, dentro do borrão. Ex.: "- " numa tela só de saídas. */
  prefix?: string;
  className?: string;
}

/**
 * Um valor em dinheiro na tela.
 *
 * Existe por causa do modo discreto: `.money` é a marca que o CSS procura para
 * borrar (`html[data-privacy="on"] .money`). Escrever `formatCurrency(x)` solto
 * continua funcionando — só não some quando o usuário aperta o olho. Por isso
 * todo valor visível passa por aqui.
 */
export function Money({ value, showSign, prefix, className }: MoneyProps) {
  return (
    <span className={className ? `money ${className}` : "money"}>
      {prefix}
      {formatCurrency(value, showSign ? { showSign: true } : undefined)}
    </span>
  );
}
