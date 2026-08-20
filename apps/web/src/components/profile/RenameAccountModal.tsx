import React, { useState, useEffect, FormEvent } from "react";
import type { AccountDTO } from "@poup/shared";
import { renameAccount } from "../../lib/api";
import { Modal } from "../ui/Modal";
import { Field } from "../ui/Field";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { useToast } from "../ui/Toast";

export interface RenameAccountModalProps {
  account: AccountDTO | null;
  onClose: () => void;
  onSaved: () => void;
}

export function RenameAccountModal({ account, onClose, onSaved }: RenameAccountModalProps) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  useEffect(() => {
    setName(account?.customName ?? "");
  }, [account]);

  if (!account) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!account) return;

    try {
      setSaving(true);
      // Vazio limpa o apelido e devolve o nome que vem do banco.
      await renameAccount(account.id, { name: name.trim() || null });
      toast.success("Conta renomeada.");
      onSaved();
      onClose();
    } catch (err: any) {
      toast.error(err.message || "Erro ao renomear a conta.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen={!!account}
      onClose={onClose}
      title="Renomear conta"
      maxWidth="sm"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="rename-account-form" variant="primary" size="sm" loading={saving}>
            Salvar
          </Button>
        </>
      }
    >
      <form id="rename-account-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field id="acc-name" label="Nome da conta">
          <Input
            id="acc-name"
            value={name}
            placeholder={account.originalName}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          <p className="text-[11px] text-text-secondary leading-relaxed">
            Deixe em branco para voltar ao nome do banco:{" "}
            <span className="font-semibold text-text-primary">{account.originalName}</span>. O
            apelido é preservado nas próximas sincronizações.
          </p>
        </Field>
      </form>
    </Modal>
  );
}
