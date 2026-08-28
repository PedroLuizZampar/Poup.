import React, { FormEvent, useState } from "react";
import type { HouseholdInviteDTO, HouseholdMemberDTO, HouseholdStateDTO } from "@poup/shared";
import {
  ApiError,
  acceptHouseholdInvite,
  cancelHouseholdInvite,
  declineHouseholdInvite,
  leaveHousehold,
  sendHouseholdInvite,
} from "../../lib/api";
import { Card } from "../ui/Card";
import { Field } from "../ui/Field";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { UserAvatar } from "../ui/UserAvatar";
import { useToast } from "../ui/Toast";
import { useConfirm } from "../ui/ConfirmDialog";

export interface ContaConjuntaSectionProps {
  household: HouseholdStateDTO;
  /** Refaz o `fetchMe` — é como a página mantém `user.household` atual depois de qualquer ação aqui. */
  onChanged: () => void | Promise<void>;
}

type Estado = "convite-recebido" | "espaco-formado" | "convite-enviado" | "sozinho";

/**
 * Qual dos quatro estados mostrar, e nesta ordem: um convite recebido pede
 * resposta antes de qualquer outra coisa; um espaço já formado (a API só
 * devolve convites pendentes, então checar o array basta) vem antes de um
 * convite que eu mesmo mandei; sozinho é o que sobra.
 */
export function resolverEstado(household: HouseholdStateDTO): Estado {
  if (household.invitesReceived.length > 0) return "convite-recebido";
  if (household.members.length > 1) return "espaco-formado";
  if (household.invitesSent.length > 0) return "convite-enviado";
  return "sozinho";
}

export function ContaConjuntaSection({ household, onChanged }: ContaConjuntaSectionProps) {
  const estado = resolverEstado(household);

  return (
    <section id="conjunta" className="scroll-mt-20">
      <Card variant="panel">
        <div>
          <h2 className="font-display font-bold text-base md:text-lg text-text-primary">
            Conta conjunta
          </h2>
          <p className="text-xs text-text-secondary mt-0.5">
            Divida a visão financeira com outra pessoa
          </p>
        </div>

        {estado === "convite-recebido" && (
          <ConviteRecebido invite={household.invitesReceived[0]} onChanged={onChanged} />
        )}
        {estado === "espaco-formado" && (
          <EspacoFormado members={household.members} onChanged={onChanged} />
        )}
        {estado === "convite-enviado" && (
          <ConviteEnviado invite={household.invitesSent[0]} onChanged={onChanged} />
        )}
        {estado === "sozinho" && <ConvidarForm onChanged={onChanged} />}
      </Card>
    </section>
  );
}

/** Estado 1: alguém me convidou e ainda não respondi. */
function ConviteRecebido({
  invite,
  onChanged,
}: {
  invite: HouseholdInviteDTO;
  onChanged: () => void | Promise<void>;
}) {
  const [aceitando, setAceitando] = useState(false);
  const [recusando, setRecusando] = useState(false);
  const toast = useToast();

  async function handleAceitar() {
    try {
      setAceitando(true);
      await acceptHouseholdInvite(invite.id);
      toast.success("Pronto! As contas de vocês agora são um conjunto só.");
      await onChanged();
    } catch (err: any) {
      toast.error(err.message || "Não foi possível aceitar o convite.");
    } finally {
      setAceitando(false);
    }
  }

  async function handleRecusar() {
    try {
      setRecusando(true);
      await declineHouseholdInvite(invite.id);
      toast.success("Convite recusado.");
      await onChanged();
    } catch (err: any) {
      toast.error(err.message || "Não foi possível recusar o convite.");
    } finally {
      setRecusando(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <UserAvatar name={invite.inviter.name} avatarUrl={invite.inviter.avatarUrl} size="md" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text-primary truncate">
            {invite.inviter.name} quer dividir a conta com você
          </p>
          <p className="text-xs text-text-secondary mt-0.5 leading-relaxed">
            As categorias e orçamentos de vocês dois viram um conjunto só; as de mesmo nome são
            fundidas.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          size="sm"
          loading={aceitando}
          disabled={recusando}
          onClick={handleAceitar}
        >
          Aceitar
        </Button>
        <Button
          variant="secondary"
          size="sm"
          loading={recusando}
          disabled={aceitando}
          onClick={handleRecusar}
        >
          Recusar
        </Button>
      </div>
    </div>
  );
}

/** Estado 2: o espaço já tem mais de uma pessoa. */
function EspacoFormado({
  members,
  onChanged,
}: {
  members: HouseholdMemberDTO[];
  onChanged: () => void | Promise<void>;
}) {
  const [saindo, setSaindo] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();

  // A saída não tem desfazer: não há de-para guardado, então voltar atrás
  // significaria convidar e fundir de novo, e a fusão não devolve o conjunto que
  // cada um tinha antes. O aviso conta as duas consequências que surpreendem —
  // a cópia e o teto que vale inteiro para os dois — antes do clique.
  async function handleSair() {
    const ok = await confirm({
      title: "Sair da conta conjunta",
      message:
        "Cada um fica com uma cópia das categorias, orçamentos e metas, e o histórico de vocês " +
        "continua inteiro. O limite de cada orçamento vale integralmente para os dois.",
      confirmText: "Sair",
      danger: true,
    });
    if (!ok) return;

    try {
      setSaindo(true);
      await leaveHousehold();
      toast.success("Conta conjunta desfeita.");
      await onChanged();
    } catch (err: any) {
      toast.error(err.message || "Não foi possível sair da conta conjunta.");
    } finally {
      setSaindo(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        {members.map((member) => (
          <div
            key={member.id}
            className="flex items-center gap-3 p-3 rounded-tile bg-surface-alt/50 border border-border"
          >
            <UserAvatar name={member.name} avatarUrl={member.avatarUrl} size="sm" />
            <span className="text-sm font-semibold text-text-primary truncate">{member.name}</span>
          </div>
        ))}
      </div>

      <Button
        variant="secondary"
        size="sm"
        loading={saindo}
        onClick={handleSair}
        className="self-start"
      >
        Sair da conta conjunta
      </Button>
    </div>
  );
}

/** Estado 3: eu convidei alguém e ainda não respondeu. */
function ConviteEnviado({
  invite,
  onChanged,
}: {
  invite: HouseholdInviteDTO;
  onChanged: () => void | Promise<void>;
}) {
  const [cancelando, setCancelando] = useState(false);
  const toast = useToast();

  async function handleCancelar() {
    try {
      setCancelando(true);
      await cancelHouseholdInvite(invite.id);
      toast.success("Convite cancelado.");
      await onChanged();
    } catch (err: any) {
      toast.error(err.message || "Não foi possível cancelar o convite.");
    } finally {
      setCancelando(false);
    }
  }

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-text-primary">Convite enviado</p>
        <p className="text-xs text-text-secondary mt-0.5 truncate">
          Aguardando resposta de <span className="text-text-primary">{invite.inviteeEmail}</span>
        </p>
      </div>
      <Button
        variant="secondary"
        size="sm"
        loading={cancelando}
        onClick={handleCancelar}
        className="self-start sm:self-auto shrink-0"
      >
        Cancelar
      </Button>
    </div>
  );
}

/** Estado 4: sozinho no espaço, sem convite em andamento. */
function ConvidarForm({ onChanged }: { onChanged: () => void | Promise<void> }) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [enviando, setEnviando] = useState(false);
  const toast = useToast();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    if (!email.trim()) {
      setError("Informe um e-mail.");
      return;
    }

    try {
      setEnviando(true);
      setError(undefined);
      await sendHouseholdInvite(email.trim());
      toast.success("Convite enviado.");
      setEmail("");
      await onChanged();
    } catch (err) {
      if (err instanceof ApiError && err.field === "email") {
        setError(err.message);
      } else {
        toast.error(err instanceof Error ? err.message : "Não foi possível enviar o convite.");
      }
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <p className="text-xs text-text-secondary leading-relaxed max-w-prose">
        Convide outra pessoa do Poup para dividir a visão financeira. As categorias e orçamentos de
        mesmo nome viram um conjunto só.
      </p>

      <div className="flex flex-col sm:flex-row sm:items-end gap-3">
        <Field id="conjunta-email" label="E-mail" error={error} className="flex-1">
          <Input
            id="conjunta-email"
            type="email"
            placeholder="nome@exemplo.com"
            hasError={Boolean(error)}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Button
          type="submit"
          variant="primary"
          size="md"
          loading={enviando}
          className="shrink-0"
        >
          Convidar
        </Button>
      </div>
    </form>
  );
}
