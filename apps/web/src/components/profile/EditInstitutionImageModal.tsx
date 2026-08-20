import React, { useState, useEffect, useRef } from "react";
import type { ItemDTO } from "@poup/shared";
import { updateItemImage } from "../../lib/api";
import { fileToResizedDataUrl } from "../../lib/imageUpload";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { InstitutionLogo } from "../ui/InstitutionLogo";
import { useToast } from "../ui/Toast";

export interface EditInstitutionImageModalProps {
  item: ItemDTO | null;
  onClose: () => void;
  onSaved: () => void;
}

export function EditInstitutionImageModal({
  item,
  onClose,
  onSaved,
}: EditInstitutionImageModalProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  useEffect(() => {
    setImageUrl(item?.customImageUrl ?? null);
  }, [item]);

  if (!item) return null;

  async function handlePickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    try {
      setImageUrl(await fileToResizedDataUrl(file));
    } catch (err: any) {
      toast.error(err.message || "Não foi possível ler a imagem.");
    }
  }

  async function handleSave() {
    if (!item) return;

    try {
      setSaving(true);
      await updateItemImage(item.id, imageUrl);
      toast.success(imageUrl ? "Imagem atualizada." : "Imagem restaurada para a do banco.");
      onSaved();
      onClose();
    } catch (err: any) {
      toast.error(err.message || "Erro ao salvar a imagem.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen={!!item}
      onClose={onClose}
      title={`Imagem de ${item.institutionName}`}
      maxWidth="sm"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" size="sm" onClick={handleSave} loading={saving}>
            Salvar imagem
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-4">
          <InstitutionLogo
            name={item.institutionName}
            imageUrl={item.institutionImageUrl}
            customImageUrl={imageUrl}
            size="lg"
            className="shadow-sh1"
          />
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()}>
              Escolher imagem
            </Button>
            {imageUrl && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setImageUrl(null)}
                className="hover:!text-error"
              >
                Usar a do banco
              </Button>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handlePickFile}
            className="hidden"
          />
        </div>

        <p className="text-[11px] text-text-secondary leading-relaxed">
          A imagem escolhida aqui tem precedência sobre a logo que vem do conector e{" "}
          <span className="font-semibold text-text-primary">
            não é sobrescrita ao sincronizar
          </span>
          . PNG, SVG, JPG ou WebP — imagens grandes são reduzidas para 256px.
        </p>
      </div>
    </Modal>
  );
}
