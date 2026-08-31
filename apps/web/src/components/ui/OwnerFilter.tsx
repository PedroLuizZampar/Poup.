import { useMemo } from "react";
import type { HouseholdMemberDTO } from "@poup/shared";
import { Select } from "./Select";
import { UserAvatar } from "./UserAvatar";

export interface OwnerFilterProps {
  members: HouseholdMemberDTO[];
  value: string;
  onChange: (value: string) => void;
  size?: "sm" | "md";
}

/** O primeiro nome basta na opção, e é o que cabe no seletor do mobile. */
function primeiroNome(nome: string): string {
  return nome.split(" ")[0] || nome;
}

/**
 * O dono a mostrar numa linha ou no modal, cruzando o `ownerUserId` da
 * transação (Task 16 manda só o id) com os membros do espaço.
 *
 * Null quando o espaço é de uma pessoa só — ali não há "dono" a indicar,
 * é sempre quem está olhando — ou quando o cruzamento falha, o que acontece
 * com uma transação antiga de alguém que já saiu do espaço: melhor esconder o
 * avatar do que apontar para o membro errado.
 */
export function donoDaLinha(
  members: HouseholdMemberDTO[],
  ownerUserId: string
): HouseholdMemberDTO | null {
  if (members.length < 2) return null;
  return members.find((m) => m.id === ownerUserId) ?? null;
}

/**
 * O `owner` que vai para a API, cruzando a seleção da tela com o tamanho atual
 * do espaço — e não só a seleção sozinha.
 *
 * "all" é o padrão e soma o espaço inteiro, o que a API só sabe fazer quando o
 * parâmetro está ausente, nunca quando ele chega como a string "all". E um
 * espaço que voltou a ser de uma pessoa só sempre soma undefined, não importa
 * o que `ownerFilter` ainda guarde: é o caso de alguém sair de um espaço
 * enquanto a tela de outra pessoa ainda tinha esse alguém selecionado — sem
 * essa segunda checagem, o id selecionado não pertence mais a ninguém do
 * espaço e a API recusa com 403. `members.length` (não `=== 2`) porque nada
 * no modelo impede um espaço com três ou mais membros.
 */
export function ownerParaQuery(
  members: HouseholdMemberDTO[],
  ownerFilter: string
): string | undefined {
  if (members.length < 2) return undefined;
  return ownerFilter === "all" ? undefined : ownerFilter;
}

/**
 * "Todos / Fulano / Beltrano", com a foto de cada um.
 *
 * Some quando o espaço tem um membro só: ali seria um seletor de uma opção. É o
 * próprio componente que decide isso, e não cada uma das três telas.
 */
export function OwnerFilter({ members, value, onChange, size = "md" }: OwnerFilterProps) {
  const options = useMemo(
    () => [
      { value: "all", label: "Todos" },
      ...members.map((m) => ({ value: m.id, label: primeiroNome(m.name) })),
    ],
    [members]
  );

  const porId = useMemo(() => {
    const map: Record<string, HouseholdMemberDTO> = {};
    for (const m of members) map[m.id] = m;
    return map;
  }, [members]);

  if (members.length < 2) return null;

  return (
    <Select
      size={size}
      value={value}
      onChange={onChange}
      options={options}
      aria-label="Pessoa"
      renderOption={(opt) => {
        const membro = porId[opt.value];
        if (!membro) return <span className="truncate">{opt.label}</span>;
        return (
          <span className="flex items-center gap-2 min-w-0">
            <UserAvatar size="xs" name={membro.name} avatarUrl={membro.avatarUrl} />
            <span className="truncate">{opt.label}</span>
          </span>
        );
      }}
    />
  );
}
