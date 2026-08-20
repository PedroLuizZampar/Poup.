import React, { useState, useMemo, FormEvent } from "react";
import type { GoalDTO, AccountDTO } from "@poup/shared";
import { createGoal, updateGoal, deleteGoal } from "../../lib/api";
import { PlusIcon, TrashIcon, EditIcon } from "../icons/Icons";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { Field } from "../ui/Field";
import { Input } from "../ui/Input";
import { Select } from "../ui/Select";
import { Badge } from "../ui/Badge";
import { CurrencyInput } from "../ui/CurrencyInput";
import { ProgressBar } from "../ui/ProgressBar";
import { EmptyState } from "../common/EmptyState";
import { CardSkeleton } from "../common/Skeleton";
import { useConfirm } from "../ui/ConfirmDialog";
import { useToast } from "../ui/Toast";
import { formatCurrency, formatDate } from "../../lib/format";

export interface GoalsTabProps {
  goals: GoalDTO[];
  accounts: AccountDTO[];
  loading: boolean;
  onRefresh: () => void;
}

export function GoalsTab({ goals, accounts, loading, onRefresh }: GoalsTabProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<GoalDTO | null>(null);
  const [name, setName] = useState("");
  const [accountId, setAccountId] = useState("");
  const [targetAmount, setTargetAmount] = useState(0);
  const [targetDate, setTargetDate] = useState("");
  const [saving, setSaving] = useState(false);

  const confirm = useConfirm();
  const toast = useToast();

  const accountOptions = useMemo(
    () =>
      accounts.map((a) => ({
        value: a.id,
        label: `${a.name} — ${formatCurrency(a.balance)}`,
      })),
    [accounts]
  );

  const hasAccounts = accounts.length > 0;

  function openCreateModal() {
    setEditing(null);
    setName("");
    setAccountId(accounts[0]?.id ?? "");
    setTargetAmount(5000);
    setTargetDate("");
    setIsModalOpen(true);
  }

  function openEditModal(goal: GoalDTO) {
    setEditing(goal);
    setName(goal.name);
    setAccountId(goal.accountId ?? accounts[0]?.id ?? "");
    setTargetAmount(goal.targetAmount);
    // O input `date` só aceita YYYY-MM-DD; a API devolve ISO completo.
    setTargetDate(goal.targetDate ? goal.targetDate.slice(0, 10) : "");
    setIsModalOpen(true);
  }

  function closeModal() {
    setIsModalOpen(false);
    setEditing(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || targetAmount <= 0) {
      toast.error("Preencha o nome do objetivo e o valor alvo.");
      return;
    }
    if (!accountId) {
      toast.error("Selecione a conta que acumula esta meta.");
      return;
    }

    const payload = {
      name: name.trim(),
      accountId,
      targetAmount,
      targetDate: targetDate ? new Date(targetDate).toISOString() : null,
    };

    try {
      setSaving(true);
      if (editing) {
        await updateGoal(editing.id, payload);
        toast.success("Meta atualizada com sucesso!");
      } else {
        await createGoal(payload);
        toast.success("Meta criada com sucesso!");
      }
      closeModal();
      onRefresh();
    } catch (err: any) {
      toast.error(err.message || "Erro ao salvar meta.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(goal: GoalDTO) {
    const confirmed = await confirm({
      title: `Excluir a meta "${goal.name}"?`,
      message: "O progresso acumulado desta meta não será mais acompanhado.",
      confirmText: "Excluir meta",
      danger: true,
    });

    if (!confirmed) return;

    try {
      await deleteGoal(goal.id);
      toast.success(`Meta "${goal.name}" excluída.`);
      onRefresh();
    } catch (err: any) {
      toast.error(err.message || "Erro ao excluir meta.");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Barra de Ação */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-text-secondary">
          {goals.length} {goals.length === 1 ? "meta cadastrada" : "metas cadastradas"}
        </p>
        <Button
          variant="primary"
          size="sm"
          onClick={openCreateModal}
          disabled={!hasAccounts}
          title={hasAccounts ? undefined : "Conecte uma conta bancária para criar metas"}
          iconLeft={<PlusIcon className="w-4 h-4" />}
        >
          Nova meta
        </Button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : goals.length === 0 ? (
        <div className="bg-surface rounded-panel border border-border">
          <EmptyState
            title={hasAccounts ? "Nenhuma meta cadastrada" : "Conecte uma conta primeiro"}
            description={
              hasAccounts
                ? "Vincule uma conta a cada objetivo: o saldo dela vira o acumulado da meta, e o ritmo mensal ideal é calculado sozinho."
                : "Metas acompanham o saldo de uma conta bancária. Conecte uma instituição no Perfil para começar."
            }
            action={
              hasAccounts
                ? {
                    label: "Definir primeira meta",
                    onClick: openCreateModal,
                  }
                : undefined
            }
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {goals.map((g) => {
            const progress = Math.min(100, Math.max(0, g.progress));
            const circumference = 2 * Math.PI * 18; // ~113.1
            const strokeDashoffset = circumference - (progress / 100) * circumference;
            // Meta cuja conta foi excluída: sem fonte para o acumulado, ela
            // precisa que o usuário escolha outra conta.
            const orphan = !g.accountId;

            return (
              <div
                key={g.id}
                className="bg-surface rounded-card p-6 shadow-sh1 border border-border flex flex-col justify-between gap-5 group hover:shadow-sh2 transition-shadow"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-display font-bold text-base text-text-primary truncate">
                      {g.name}
                    </h3>
                    <p className="text-caption text-text-secondary mt-0.5 tnum">
                      Alvo: {formatCurrency(g.targetAmount)}
                    </p>
                  </div>

                  {/* Anel de Progresso SVG Circular */}
                  <div className="relative w-12 h-12 shrink-0 flex items-center justify-center">
                    <svg className="w-12 h-12 -rotate-90" viewBox="0 0 44 44">
                      <circle
                        cx="22"
                        cy="22"
                        r="18"
                        className="stroke-surface-alt"
                        strokeWidth="3.5"
                        fill="transparent"
                      />
                      <circle
                        cx="22"
                        cy="22"
                        r="18"
                        className="stroke-primary transition-all duration-500 ease-out"
                        strokeWidth="3.5"
                        strokeDasharray={circumference}
                        strokeDashoffset={strokeDashoffset}
                        strokeLinecap="round"
                        fill="transparent"
                      />
                    </svg>
                    <span className="absolute font-display font-extrabold text-[11px] text-text-primary tnum">
                      {Math.round(progress)}%
                    </span>
                  </div>
                </div>

                {orphan ? (
                  <div className="bg-warning-soft rounded-tile p-3 text-caption text-text-secondary flex items-center justify-between gap-2 border border-warning/25">
                    <span>Sem conta vinculada</span>
                    <Badge variant="warning">Vincule uma conta</Badge>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-caption text-text-secondary min-w-0">
                    <span className="shrink-0">Acumula em</span>
                    <span className="font-semibold text-text-primary truncate">
                      {g.accountName}
                    </span>
                  </div>
                )}

                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between text-caption">
                    <span className="font-semibold text-text-primary tnum">
                      {formatCurrency(g.currentAmount)} acumulados
                    </span>
                    <span className="text-text-secondary tnum">
                      Falta {formatCurrency(g.remainingAmount)}
                    </span>
                  </div>
                  <ProgressBar value={g.currentAmount} max={g.targetAmount} size="sm" />
                </div>

                {g.monthlyPaceNeeded !== null && g.monthlyPaceNeeded > 0 && (
                  <div className="bg-surface-alt/70 rounded-tile p-3 text-caption text-text-secondary flex items-center justify-between border border-border/50">
                    <span>Ritmo mensal sugerido:</span>
                    <span className="font-bold text-primary tnum">
                      {formatCurrency(g.monthlyPaceNeeded)} / mês
                    </span>
                  </div>
                )}

                <div className="flex items-center justify-between pt-2 border-t border-border/50 text-caption">
                  <span className="text-text-secondary tnum">
                    {g.targetDate ? `Prazo: ${formatDate(g.targetDate)}` : "Sem prazo definido"}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      title="Editar meta"
                      aria-label={`Editar meta ${g.name}`}
                      onClick={() => openEditModal(g)}
                      className="text-text-disabled hover:text-primary transition-colors p-1 rounded-ctl focus-ring cursor-pointer"
                    >
                      <EditIcon className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      title="Excluir meta"
                      aria-label={`Excluir meta ${g.name}`}
                      onClick={() => handleDelete(g)}
                      className="text-text-disabled hover:text-error transition-colors p-1 rounded-ctl focus-ring cursor-pointer"
                    >
                      <TrashIcon className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal Nova / Editar Meta */}
      <Modal
        isOpen={isModalOpen}
        onClose={closeModal}
        title={editing ? "Editar meta" : "Nova meta financeira"}
        maxWidth="sm"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={closeModal}>
              Cancelar
            </Button>
            <Button type="submit" form="goal-form" variant="primary" size="sm" loading={saving}>
              {editing ? "Salvar alterações" : "Salvar meta"}
            </Button>
          </>
        }
      >
        <form id="goal-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field id="g-name" label="Nome do objetivo" required>
            <Input
              id="g-name"
              placeholder="Ex: Reserva de emergência, Viagem..."
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </Field>

          <Field id="g-account" label="Conta que acumula" required>
            <Select
              id="g-account"
              value={accountId}
              onChange={setAccountId}
              options={accountOptions}
              placeholder="Selecione a conta..."
            />
            <p className="text-[11px] text-text-secondary leading-relaxed">
              O saldo desta conta é o valor já guardado da meta.
            </p>
          </Field>

          <Field id="g-target" label="Valor alvo" required>
            <CurrencyInput id="g-target" value={targetAmount} onChange={setTargetAmount} />
          </Field>

          <Field id="g-date" label="Data limite (opcional)">
            <Input
              id="g-date"
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
            />
          </Field>
        </form>
      </Modal>
    </div>
  );
}
