import React, { useState, FormEvent } from "react";
import { changePassword } from "../../lib/api";
import { Modal } from "../ui/Modal";
import { Field } from "../ui/Field";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { useToast } from "../ui/Toast";

export interface ChangePasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const MIN_LENGTH = 8;

export function ChangePasswordModal({ isOpen, onClose }: ChangePasswordModalProps) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  function reset() {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    if (newPassword.length < MIN_LENGTH) {
      toast.error(`A nova senha precisa ter ao menos ${MIN_LENGTH} caracteres.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("A confirmação não corresponde à nova senha.");
      return;
    }

    try {
      setSaving(true);
      await changePassword({ currentPassword, newPassword });
      toast.success("Senha alterada com sucesso.");
      handleClose();
    } catch (err: any) {
      toast.error(err.message || "Erro ao alterar a senha.");
    } finally {
      setSaving(false);
    }
  }

  const mismatch = confirmPassword.length > 0 && confirmPassword !== newPassword;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Alterar senha"
      maxWidth="sm"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={handleClose}>
            Cancelar
          </Button>
          <Button type="submit" form="password-form" variant="primary" size="sm" loading={saving}>
            Alterar senha
          </Button>
        </>
      }
    >
      <form id="password-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field id="pw-current" label="Senha atual" required>
          <Input
            id="pw-current"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </Field>

        <Field id="pw-new" label="Nova senha" required hint={`mín. ${MIN_LENGTH} caracteres`}>
          <Input
            id="pw-new"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </Field>

        <Field
          id="pw-confirm"
          label="Confirmar nova senha"
          required
          error={mismatch ? "As senhas não conferem." : undefined}
        >
          <Input
            id="pw-confirm"
            type="password"
            autoComplete="new-password"
            hasError={mismatch}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </Field>
      </form>
    </Modal>
  );
}
