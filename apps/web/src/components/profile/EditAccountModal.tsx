import React, { useState, useEffect, FormEvent } from "react";
import type { AccountDTO, AccountType } from "@poup/shared";
import { updateAccount } from "../../lib/api";
import { ACCOUNT_TYPE_OPTIONS } from "../../lib/accounts";
import { Modal } from "../ui/Modal";
import { Field } from "../ui/Field";
import { Input } from "../ui/Input";
import { Select } from "../ui/Select";
import { Button } from "../ui/Button";
import { useToast } from "../ui/Toast";

export interface EditAccountModalProps {
  account: AccountDTO | null;
  onClose: () => void;
  onSaved: (account: AccountDTO) => void;
}

/** O que o formulário assume quando a conta ainda não tem dia cadastrado. */
const DIA_PADRAO = 10;

export function EditAccountModal({ account, onClose, onSaved }: EditAccountModalProps) {
  const [name, setName] = useState("");
  const [type, setType] = useState<AccountType>("CHECKING");
  const [dueDay, setDueDay] = useState<string>(String(DIA_PADRAO));
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (!account) return;
    setName(account.customName ?? "");
    setType(account.type);
    // Nunca vazio: o campo é obrigatório em cartão, e um formulário que abre em
    // branco convida a salvar em branco.
    setDueDay(String(account.creditCardDueDay ?? DIA_PADRAO));
  }, [account]);

  if (!account) return null;

  const isCredit = type === "CREDIT";
  const diaNumerico = Number(dueDay);
  const diaInvalido =
    isCredit && (!Number.isInteger(diaNumerico) || diaNumerico < 1 || diaNumerico > 31);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!account || diaInvalido) return;

    try {
      setSaving(true);
      const atualizada = await updateAccount(account.id, {
        // Vazio limpa o apelido e devolve o nome que vem do banco.
        name: name.trim() || null,
        // Escolher de volta o tipo que a Pluggy derivou é apagar a customização,
        // e não gravá-la: assim a conta volta a acompanhar o banco se ele mudar.
        customType: type === account.originalType ? null : type,
        ...(isCredit && { creditCardDueDay: diaNumerico }),
      });
      toast.success("Conta atualizada.");
      onSaved(atualizada);
      onClose();
    } catch (err: any) {
      toast.error(err.message || "Erro ao atualizar a conta.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen={!!account}
      onClose={onClose}
      title="Editar conta"
      maxWidth="sm"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form="edit-account-form"
            variant="primary"
            size="sm"
            loading={saving}
            disabled={diaInvalido}
          >
            Salvar
          </Button>
        </>
      }
    >
      <form id="edit-account-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
        {/* O `hint` do Field é renderizado na mesma linha do rótulo, alinhado à
            direita: cabe uma palavra, não uma frase. Explicação mais longa vai
            num <p> abaixo do campo. */}
        <Field id="account-name" label="Nome da conta" hint="Opcional">
          <Input
            id="account-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={account.originalName}
            maxLength={80}
          />
          <p className="text-[11px] text-text-secondary">
            Em branco, volta a "{account.originalName}".
          </p>
        </Field>

        <Field id="account-type" label="Tipo">
          <Select
            id="account-type"
            value={type}
            onChange={setType}
            options={ACCOUNT_TYPE_OPTIONS}
            aria-label="Tipo da conta"
          />
          <p className="text-[11px] text-text-secondary">
            O banco não informa cartão de débito. Se esta é a conta do seu cartão de
            débito, marque aqui.
          </p>
        </Field>

        {/* Só cartão de crédito tem fatura, e aí o dia não pode faltar: é ele
            que transforma o mês da parcela numa data de vencimento. */}
        {isCredit && (
          <Field
            id="account-due-day"
            label="Dia de vencimento da fatura"
            required
            error={diaInvalido ? "Informe um dia entre 1 e 31." : undefined}
          >
            <Input
              id="account-due-day"
              type="number"
              min={1}
              max={31}
              required
              value={dueDay}
              onChange={(e) => setDueDay(e.target.value)}
              hasError={diaInvalido}
            />
            <p className="text-[11px] text-text-secondary">
              É a partir daqui que o app calcula o vencimento de cada parcela.
            </p>
          </Field>
        )}
      </form>
    </Modal>
  );
}
