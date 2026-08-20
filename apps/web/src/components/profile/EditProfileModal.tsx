import React, { useState, useRef, FormEvent } from "react";
import type { UserDTO } from "@poup/shared";
import { updateProfile } from "../../lib/api";
import { fileToResizedDataUrl } from "../../lib/imageUpload";
import { Modal } from "../ui/Modal";
import { Field } from "../ui/Field";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { UserAvatar } from "../ui/UserAvatar";
import { useToast } from "../ui/Toast";

export interface EditProfileModalProps {
  isOpen: boolean;
  user: UserDTO;
  onClose: () => void;
  onSaved: (user: UserDTO) => void;
}

export function EditProfileModal({ isOpen, user, onClose, onSaved }: EditProfileModalProps) {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(user.avatarUrl);
  const [currentPassword, setCurrentPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  // Trocar o email é o que muda a credencial de acesso, então só ele pede a
  // senha atual. Nome e foto salvam direto.
  const emailChanged = email.trim().toLowerCase() !== user.email.toLowerCase();

  function resetAndClose() {
    setName(user.name);
    setEmail(user.email);
    setAvatarUrl(user.avatarUrl);
    setCurrentPassword("");
    onClose();
  }

  async function handlePickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Zera o input para que escolher o mesmo arquivo de novo continue disparando.
    e.target.value = "";
    if (!file) return;

    try {
      setAvatarUrl(await fileToResizedDataUrl(file));
    } catch (err: any) {
      toast.error(err.message || "Não foi possível ler a imagem.");
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    if (!name.trim()) {
      toast.error("Informe seu nome.");
      return;
    }
    if (emailChanged && !currentPassword) {
      toast.error("Confirme sua senha atual para trocar de email.");
      return;
    }

    try {
      setSaving(true);
      const updated = await updateProfile({
        name: name.trim(),
        email: email.trim(),
        avatarUrl,
        ...(emailChanged && { currentPassword }),
      });
      toast.success("Perfil atualizado com sucesso.");
      setCurrentPassword("");
      onSaved(updated);
      onClose();
    } catch (err: any) {
      toast.error(err.message || "Erro ao atualizar o perfil.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={resetAndClose}
      title="Editar perfil"
      maxWidth="sm"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={resetAndClose}>
            Cancelar
          </Button>
          <Button type="submit" form="profile-form" variant="primary" size="sm" loading={saving}>
            Salvar alterações
          </Button>
        </>
      }
    >
      <form id="profile-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex items-center gap-4">
          <UserAvatar name={name || user.name} avatarUrl={avatarUrl} size="lg" />
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()}>
                Trocar foto
              </Button>
              {avatarUrl && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setAvatarUrl(null)}
                  className="hover:!text-error"
                >
                  Remover
                </Button>
              )}
            </div>
            <span className="text-[11px] text-text-secondary">
              PNG, JPG ou WebP. A imagem é reduzida para 256px.
            </span>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handlePickFile}
            className="hidden"
          />
        </div>

        <Field id="p-name" label="Nome" required>
          <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>

        <Field id="p-email" label="Email" required>
          <Input
            id="p-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>

        {emailChanged && (
          <Field id="p-current" label="Senha atual" required>
            <Input
              id="p-current"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
            <p className="text-[11px] text-text-secondary">
              Trocar de email exige confirmar a senha.
            </p>
          </Field>
        )}
      </form>
    </Modal>
  );
}
