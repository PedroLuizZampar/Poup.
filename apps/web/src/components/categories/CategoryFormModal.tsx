import React, { useState, useEffect, FormEvent } from "react";
import type { CategoryDTO } from "@poup/shared";
import { Modal } from "../ui/Modal";
import { Field } from "../ui/Field";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { CategoryTile, normalizeColorKey } from "../ui/CategoryTile";
import { ColorPicker } from "./ColorPicker";
import { IconPicker } from "./IconPicker";
import { useToast } from "../ui/Toast";

export interface CategoryFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  categoryToEdit?: CategoryDTO | null;
  existingCategories: CategoryDTO[];
  onSaved: (saved: CategoryDTO) => void;
  onSaveCategory: (data: { name: string; icon: string; colorKey: string }, id?: string) => Promise<CategoryDTO>;
}

const NAME_MAX = 24;

export function CategoryFormModal({
  isOpen,
  onClose,
  categoryToEdit,
  existingCategories,
  onSaved,
  onSaveCategory,
}: CategoryFormModalProps) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("cart");
  const [colorKey, setColorKey] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (categoryToEdit) {
      setName(categoryToEdit.name);
      setIcon(categoryToEdit.icon || "folder");
      setColorKey(categoryToEdit.colorKey || "1");
    } else {
      setName("");
      setIcon("cart");
      setColorKey("1");
    }
    setError(null);
  }, [categoryToEdit, isOpen]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();

    if (!trimmed) {
      setError("Dê um nome à categoria para poder salvá-la.");
      return;
    }

    if (trimmed.length > NAME_MAX) {
      setError(`O nome deve ter no máximo ${NAME_MAX} caracteres.`);
      return;
    }

    const duplicate = existingCategories.find(
      (c) => c.name.toLowerCase() === trimmed.toLowerCase() && c.id !== categoryToEdit?.id
    );
    if (duplicate) {
      setError(`Você já tem uma categoria chamada “${duplicate.name}”. Escolha outro nome.`);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const saved = await onSaveCategory({ name: trimmed, icon, colorKey }, categoryToEdit?.id);
      toast.success(
        categoryToEdit ? "Categoria atualizada." : "Categoria criada."
      );
      onSaved(saved);
      onClose();
    } catch (err: any) {
      setError(err.message || "Não foi possível salvar a categoria. Tente de novo.");
    } finally {
      setLoading(false);
    }
  }

  const displayName = name.trim();
  const normalizedKey = normalizeColorKey(colorKey);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={categoryToEdit ? "Editar categoria" : "Nova categoria"}
      description="Nome, cor e ícone definem como ela aparece nas suas transações."
      maxWidth="2xl"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="category-form" variant="primary" size="sm" loading={loading}>
            {categoryToEdit ? "Salvar alterações" : "Criar categoria"}
          </Button>
        </>
      }
    >
      <form id="category-form" onSubmit={handleSubmit} className="flex flex-col gap-5">
        {/* Prévia no contexto real: a linha de transação é onde a categoria
            de fato aparece, então cada clique na paleta ou na grade de ícones
            se vê aqui, do jeito que ficará na lista. */}
        <div className="rounded-card bg-surface-alt/60 border border-border px-4 py-3.5 flex items-center gap-3.5">
          <CategoryTile icon={icon} colorKey={normalizedKey} size="lg" />
          <div className="min-w-0 flex-1">
            <p
              className={`font-display font-bold text-base truncate ${
                displayName ? "text-text-primary" : "text-text-secondary"
              }`}
            >
              {displayName || "Nome da categoria"}
            </p>
            <p className="text-caption text-text-secondary mt-0.5">
              Assim ela vai aparecer nas suas transações
            </p>
          </div>
          <span className="text-num text-expense tnum shrink-0">− R$ 128,90</span>
        </div>

        {/* Duas colunas a partir de md: identidade à esquerda, ícone à direita.
            Empilhadas em telas estreitas, na ordem em que se preenche. */}
        <div className="grid gap-5 md:grid-cols-2 md:gap-6">
          <div className="flex flex-col gap-5 min-w-0">
            <Field id="cat-name" label="Nome" required error={error}>
              <Input
                id="cat-name"
                placeholder="Supermercado, Aluguel, Streaming…"
                value={name}
                maxLength={NAME_MAX}
                onChange={(e) => {
                  setName(e.target.value);
                  if (error) setError(null);
                }}
                hasError={!!error}
                autoFocus
              />
            </Field>

            <div className="flex flex-col gap-2 min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-label text-text-secondary select-none">Cor</span>
              </div>
              <div className="p-2 rounded-card bg-surface-alt/50 border border-border max-w-[312px]">
                <ColorPicker value={colorKey} onChange={setColorKey} />
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2 min-w-0">
            <span className="text-label text-text-secondary select-none">Ícone</span>
            <IconPicker value={icon} onChange={setIcon} height="tall" />
          </div>
        </div>
      </form>
    </Modal>
  );
}
