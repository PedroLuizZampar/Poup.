import React, { FormEvent, useState } from "react";
import { ApiError, addItem } from "../../lib/api";
import { Modal } from "../ui/Modal";
import { Field } from "../ui/Field";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { useToast } from "../ui/Toast";

export interface AddConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdded: () => void;
  /** Sem credenciais cadastradas não há como validar o item na Pluggy. */
  hasCredentials: boolean;
}

/**
 * Adiciona uma conexão bancária a partir do id do item copiado do painel da
 * Pluggy. A importação é síncrona de propósito: o modal só fecha quando já dá
 * para dizer o que entrou (instituição, contas, transações).
 */
export function AddConnectionModal({
  isOpen,
  onClose,
  onAdded,
  hasCredentials,
}: AddConnectionModalProps) {
  const [itemId, setItemId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  function handleClose() {
    setItemId("");
    setError(null);
    onClose();
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    if (!itemId.trim()) {
      setError("Cole o id do item.");
      return;
    }

    try {
      setSaving(true);
      setError(null);
      const result = await addItem(itemId.trim());
      const institution = result.item?.institutionName ?? "Instituição";
      toast.success(
        `${institution} conectada — ${result.accountsSynced} contas e ${result.transactionsSynced} transações importadas.`
      );
      onAdded();
      handleClose();
    } catch (err) {
      const message =
        err instanceof ApiError && err.code === "MISSING_PLUGGY_CREDENTIALS"
          ? "Cadastre suas credenciais da Pluggy antes de adicionar uma conexão."
          : err instanceof Error
            ? err.message
            : "Não foi possível adicionar a conexão.";
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Adicionar conexão"
      description="No painel da Pluggy, abra a conexão do banco e copie o id do item (Item ID)."
      maxWidth="sm"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={handleClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form="add-connection-form"
            variant="primary"
            size="sm"
            loading={saving}
            disabled={!hasCredentials}
          >
            Conectar e sincronizar
          </Button>
        </>
      }
    >
      <form id="add-connection-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
        {!hasCredentials && (
          <p
            role="alert"
            className="p-3.5 rounded-tile bg-warning-soft border border-warning/20 text-xs font-medium leading-relaxed text-text-primary"
          >
            Cadastre suas credenciais da Pluggy primeiro — sem elas o app não consegue conferir o
            item nem importar as contas.
          </p>
        )}

        <Field
          id="add-item-id"
          label="Item ID"
          required
          error={error ?? undefined}
          hint="do painel da Pluggy"
        >
          <Input
            id="add-item-id"
            autoComplete="off"
            spellCheck={false}
            placeholder="00000000-0000-0000-0000-000000000000"
            hasError={Boolean(error)}
            disabled={!hasCredentials}
            value={itemId}
            onChange={(e) => {
              setItemId(e.target.value);
              if (error) setError(null);
            }}
          />
        </Field>

        <p className="text-xs text-text-secondary leading-relaxed">
          A importação traz as contas e o histórico de transações da instituição, e pode levar
          alguns segundos.
        </p>
      </form>
    </Modal>
  );
}
