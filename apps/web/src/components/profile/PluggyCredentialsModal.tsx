import React, { FormEvent, useState } from "react";
import type { PluggyCredentialsDTO } from "@poup/shared";
import { ApiError, updatePluggyCredentials } from "../../lib/api";
import { Modal } from "../ui/Modal";
import { Field } from "../ui/Field";
import { Input } from "../ui/Input";
import { SecretInput } from "../ui/SecretInput";
import { Button } from "../ui/Button";
import { useToast } from "../ui/Toast";

export interface PluggyCredentialsModalProps {
  isOpen: boolean;
  currentClientId: string | null;
  onClose: () => void;
  onSaved: (credentials: PluggyCredentialsDTO) => void;
}

type FieldName = "clientId" | "clientSecret" | "currentPassword";

/**
 * Troca das credenciais da aplicação Pluggy.
 *
 * O secret nunca chega ao app, então o campo começa vazio mesmo quando já
 * existe um cadastrado: não há o que pré-preencher, e salvar exige informar o
 * par completo. A senha atual é pedida porque isto dá acesso a dados bancários.
 */
export function PluggyCredentialsModal({
  isOpen,
  currentClientId,
  onClose,
  onSaved,
}: PluggyCredentialsModalProps) {
  const [clientId, setClientId] = useState(currentClientId ?? "");
  const [clientSecret, setClientSecret] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  function handleClose() {
    setClientSecret("");
    setCurrentPassword("");
    setErrors({});
    onClose();
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    const found: Partial<Record<FieldName, string>> = {};
    if (!clientId.trim()) found.clientId = "Informe o Client ID.";
    if (!clientSecret.trim()) found.clientSecret = "Informe o Client Secret.";
    if (!currentPassword) found.currentPassword = "Informe sua senha atual.";
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }

    try {
      setSaving(true);
      setErrors({});
      const credentials = await updatePluggyCredentials({
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
        currentPassword,
      });
      toast.success("Credenciais da Pluggy atualizadas.");
      onSaved(credentials);
      handleClose();
    } catch (err) {
      if (err instanceof ApiError && err.field) {
        setErrors({ [err.field as FieldName]: err.message });
      } else {
        toast.error(err instanceof Error ? err.message : "Erro ao salvar as credenciais.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Credenciais da Pluggy"
      description="Copie as duas chaves em Applications, no painel da Pluggy. Elas são conferidas com a Pluggy antes de serem salvas."
      maxWidth="sm"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={handleClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form="pluggy-credentials-form"
            variant="primary"
            size="sm"
            loading={saving}
          >
            Salvar credenciais
          </Button>
        </>
      }
    >
      <form id="pluggy-credentials-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field id="cred-client-id" label="Client ID" required error={errors.clientId}>
          <Input
            id="cred-client-id"
            autoComplete="off"
            spellCheck={false}
            placeholder="00000000-0000-0000-0000-000000000000"
            hasError={Boolean(errors.clientId)}
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
          />
        </Field>

        <Field id="cred-client-secret" label="Client Secret" required error={errors.clientSecret}>
          <SecretInput
            id="cred-client-secret"
            autoComplete="off"
            spellCheck={false}
            placeholder="Cole o secret da sua aplicação"
            hasError={Boolean(errors.clientSecret)}
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
          />
        </Field>

        <Field
          id="cred-password"
          label="Sua senha atual"
          required
          error={errors.currentPassword}
        >
          <SecretInput
            id="cred-password"
            autoComplete="current-password"
            hasError={Boolean(errors.currentPassword)}
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </Field>
      </form>
    </Modal>
  );
}
