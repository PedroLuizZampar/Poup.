import React, { useState, useEffect, useMemo, FormEvent } from "react";
import type { TransactionDTO, CategoryDTO, CompensationDetailDTO } from "@poup/shared";
import {
  fetchCompensationDetail,
  undoCompensation,
  updateTransaction,
} from "../../lib/api";
import { Modal } from "../ui/Modal";
import { Field } from "../ui/Field";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { CategoryTile } from "../ui/CategoryTile";
import { CategorySelectModal } from "../categories/CategorySelectModal";
import { SimilarTransactionsModal } from "./SimilarTransactionsModal";
import { CompensationModal } from "./CompensationModal";
import { useToast } from "../ui/Toast";
import { formatCurrency, formatDate } from "../../lib/format";
import { InstallmentList } from "./InstallmentList";
import { useCategoryMap } from "../../hooks/useCategories";
import { displayCategory } from "../../lib/categories";
import { Money } from "../ui/Money";
import { donoDaLinha } from "../ui/OwnerFilter";
import { UserAvatar } from "../ui/UserAvatar";
import { useCurrentUser } from "../../hooks/useCurrentUser";

interface TransactionDetailModalProps {
  transaction: TransactionDTO | null;
  /** Todas, inclusive as de sistema: o seletor filtra, a exibição precisa. */
  categories: CategoryDTO[];
  onClose: () => void;
  onUpdated: (updated: TransactionDTO) => void;
  /**
   * Recarrega a lista inteira. Compensar e desfazer mexem em N+1 linhas de uma
   * vez, e `onUpdated` só sabe trocar uma.
   */
  onReload?: () => void;
}

export function TransactionDetailModal({
  transaction,
  categories,
  onClose,
  onUpdated,
  onReload,
}: TransactionDetailModalProps) {
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  /** Categoria recém-aplicada, quando vale oferecer repeti-la nas parecidas. */
  const [similarFor, setSimilarFor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isCompensationOpen, setIsCompensationOpen] = useState(false);
  const [undoing, setUndoing] = useState(false);
  /** As duas pontas do vínculo, quando esta transação está compensada. */
  const [compensacao, setCompensacao] = useState<CompensationDetailDTO | null>(null);
  const toast = useToast();
  // O modal está sempre sob o `AppLayout` — é `TransactionsPage` quem o abre,
  // e ela já vive dentro do `Outlet` que carrega o contexto do usuário — então
  // dá para ler os membros do espaço direto daqui, sem precisar de mais uma
  // prop repetindo o que a página já tem.
  const membros = useCurrentUser().household.members;

  useEffect(() => {
    if (transaction) {
      setDescription(transaction.description);
      setCategoryId(transaction.categoryId);
      setNote(transaction.note || "");
    }
  }, [transaction]);

  /**
   * Qual compra este estorno cancelou — ou, numa parcela, qual crédito a
   * cancelou. Só é buscado quando há vínculo: a lista não carrega isso, porque
   * só interessa a quem abriu a transação.
   */
  useEffect(() => {
    if (!transaction?.compensationId) {
      setCompensacao(null);
      return;
    }

    let atual = true;
    void (async () => {
      try {
        const { compensation } = await fetchCompensationDetail(transaction.id);
        if (atual) setCompensacao(compensation);
      } catch (err) {
        console.error("Erro ao buscar o vínculo de compensação:", err);
        if (atual) setCompensacao(null);
      }
    })();

    return () => {
      atual = false;
    };
  }, [transaction?.id, transaction?.compensationId]);

  const categoryMap = useCategoryMap(categories);
  // O mapa fica com todas para saber desenhar "Transferência entre contas";
  // o seletor recebe só o que o usuário pode escolher.
  const selectableCategories = useMemo(
    () => categories.filter((c) => !c.systemKey),
    [categories]
  );

  // A oculta "Sem categoria (despesa/receita)" é o `null` da tela: o seletor
  // precisa marcá-la como "Sem categoria" em vez de não marcar nada.
  const currentCategory = displayCategory(categoryId ? categoryMap[categoryId] : null);
  const selectedInPicker = currentCategory?.id ?? null;

  /**
   * A outra ponta do vínculo, do ponto de vista de quem está aberto: no crédito
   * mostra-se a compra; numa parcela, o crédito que a cancelou. Mostrar a
   * própria linha de volta não diria nada.
   */
  const ehOEstorno = Boolean(
    compensacao && transaction && compensacao.estorno.id === transaction.id
  );

  const contraparte = !compensacao
    ? null
    : ehOEstorno
      ? {
          description: compensacao.compra.description,
          valor: compensacao.compra.total,
          detalhe: [
            compensacao.compra.installmentTotal
              ? `${compensacao.compra.installmentTotal}x de ${formatCurrency(
                  compensacao.compra.total / compensacao.compra.installmentTotal
                )}`
              : null,
            compensacao.compra.purchaseDate
              ? `comprado em ${formatDate(compensacao.compra.purchaseDate)}`
              : null,
            // Só aparece quando o histórico veio cortado: explica um total que a
            // pessoa pode não reconhecer.
            compensacao.compra.installmentTotal &&
            compensacao.compra.parcelasConhecidas < compensacao.compra.installmentTotal
              ? `${compensacao.compra.parcelasConhecidas} de ${compensacao.compra.installmentTotal} parcelas importadas`
              : null,
          ]
            .filter(Boolean)
            .join(" · "),
        }
      : {
          description: compensacao.estorno.description,
          valor: compensacao.estorno.amount,
          detalhe: `estorno de ${formatDate(compensacao.estorno.date)}`,
        };

  if (!transaction) return null;

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!transaction) return;

    try {
      setLoading(true);
      const updated = await updateTransaction(transaction.id, {
        description: description.trim(),
        categoryId,
        note: note.trim() || null,
      });
      toast.success("Transação atualizada com sucesso.");
      onUpdated(updated);

      // A categoria desta transação já está salva; o modal cuida só das outras.
      // Só faz sentido quando a categoria de fato mudou para uma selecionável —
      // repetir uma oculta em massa não é uma decisão, é um estado de espera.
      const escolhida = displayCategory(categoryId ? categoryMap[categoryId] : null);
      const mudou = Boolean(categoryId) && categoryId !== transaction.categoryId;
      if (mudou && escolhida && !escolhida.systemKey) {
        setSimilarFor(categoryId);
        return;
      }

      onClose();
    } catch (err: any) {
      toast.error(err.message || "Erro ao atualizar a transação.");
    } finally {
      setLoading(false);
    }
  }

  /**
   * Desfaz o vínculo a partir desta ponta, seja ela o crédito ou uma parcela: o
   * servidor limpa o grupo inteiro. Recarrega tudo porque N+1 linhas mudaram.
   */
  async function desfazer() {
    if (!transaction || undoing) return;

    try {
      setUndoing(true);
      const { afetadas } = await undoCompensation(transaction.id);
      toast.success("Compensação desfeita.", `${afetadas} lançamentos voltaram aos totais.`);
      onReload?.();
      onClose();
    } catch (err: any) {
      toast.error(err.message || "Erro ao desfazer a compensação.");
    } finally {
      setUndoing(false);
    }
  }

  return (
    <Modal
      isOpen={!!transaction}
      onClose={onClose}
      title="Detalhes da transação"
      maxWidth="md"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form="transaction-detail-form"
            variant="primary"
            size="sm"
            loading={loading}
          >
            Salvar alterações
          </Button>
        </>
      }
    >
      <form id="transaction-detail-form" onSubmit={handleSave} className="flex flex-col gap-4">
        {/* Metadados: Valor e Data/Conta */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3.5 rounded-card bg-surface-alt/60 border border-border flex flex-col justify-between">
            <span className="text-overline uppercase tracking-wider text-text-secondary">
              Valor
            </span>
            <div className="flex items-center gap-1.5 mt-1">
              <span
                className={`font-display font-extrabold text-lg tnum ${
                  transaction.type === "INCOME" ? "text-income" : "text-expense"
                }`}
              >
                {transaction.type === "INCOME" ? "+ " : "- "}
                <Money value={transaction.amount} />
              </span>
            </div>
          </div>

          <div className="p-3.5 rounded-card bg-surface-alt/60 border border-border flex flex-col justify-between">
            <span className="text-overline uppercase tracking-wider text-text-secondary">
              Data e Conta
            </span>
            <div className="mt-1">
              <span className="text-xs font-semibold text-text-primary block tnum">
                {formatDate(transaction.date)}
              </span>
              <span className="flex items-center gap-1.5 min-w-0">
                {(() => {
                  const dono = donoDaLinha(membros, transaction.ownerUserId);
                  return dono ? (
                    <UserAvatar size="xs" name={dono.name} avatarUrl={dono.avatarUrl} />
                  ) : null;
                })()}
                <span className="text-[11px] text-text-secondary truncate">
                  {transaction.accountName || "Conta principal"}
                </span>
              </span>
            </div>
          </div>
        </div>

        {/* Parcela só aparece quando existe — a maioria das transações não é
            parcelada, e um "Parcela —" ocuparia linha para dizer nada. O
            vencimento vem do dia cadastrado no cartão; sem ele, some.

            A lista das outras parcelas mora aqui, e não num dropdown na grid:
            "quais já paguei?" é pergunta de detalhe, e é aqui que há espaço
            para respondê-la sem espremer oito linhas numa linha de tabela. */}
        {transaction.installmentTotal && (
          <div className="p-3.5 rounded-card bg-surface-alt/60 border border-border flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <span className="text-overline uppercase tracking-wider text-text-secondary block">
                  Parcelamento
                </span>
                <span className="text-xs font-semibold text-text-primary tnum">
                  Parcela {transaction.installmentIndex} de {transaction.installmentTotal}
                </span>
              </div>
              {transaction.dueDate && (
                <div className="text-right shrink-0">
                  <span className="text-overline uppercase tracking-wider text-text-secondary block">
                    Vencimento
                  </span>
                  <span className="text-xs font-semibold text-text-primary tnum">
                    {formatDate(transaction.dueDate)}
                  </span>
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-border/60">
              <InstallmentList transactionId={transaction.id} destacar={transaction.id} />
            </div>
          </div>
        )}

        {/* Descrição */}
        <Field id="tx-desc" label="Descrição" required>
          <Input
            id="tx-desc"
            required
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>

        {/* Categoria com Modal Dedicado */}
        <Field id="tx-cat" label="Categoria">
          <button
            id="tx-cat"
            type="button"
            onClick={() => setIsCategoryModalOpen(true)}
            className="w-full h-ctl px-3.5 flex items-center justify-between gap-2 rounded-ctl bg-surface-alt text-text-primary border border-border hover:border-border-strong focus-ring cursor-pointer select-none transition-[border-color,box-shadow] duration-150 text-left text-sm"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              {currentCategory ? (
                <>
                  <CategoryTile
                    icon={currentCategory.icon}
                    colorKey={currentCategory.colorKey}
                    size="sm"
                  />
                  <span className="truncate font-medium">{currentCategory.name}</span>
                </>
              ) : (
                <>
                  <div className="w-7 h-7 rounded-tile bg-surface-sunken flex items-center justify-center text-text-disabled text-xs shrink-0 border border-border">
                    ✕
                  </div>
                  <span className="text-text-disabled font-normal">Sem categoria</span>
                </>
              )}
            </div>

            <span className="text-xs font-semibold text-primary hover:underline shrink-0">
              Alterar
            </span>
          </button>

          {similarFor && (
        <SimilarTransactionsModal
          isOpen={true}
          onClose={() => {
            setSimilarFor(null);
            onClose();
          }}
          transactionId={transaction.id}
          categoryId={similarFor}
          categoryMap={categoryMap}
        />
      )}

      <CategorySelectModal
            isOpen={isCategoryModalOpen}
            onClose={() => setIsCategoryModalOpen(false)}
            categories={selectableCategories}
            selectedCategoryId={selectedInPicker}
            onSelectCategory={setCategoryId}
          />
        </Field>

        {/* Compensação de estorno.
            Só nasce no crédito: é a ordem em que a pessoa encontra o problema —
            o estorno aparece na lista, e a pergunta seguinte é de onde ele veio.
            Compensada, a linha troca a ação pela faixa com o desfazer. */}
        {transaction.compensationId ? (
          <div className="p-3.5 rounded-card bg-surface-alt/60 border border-border flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <span className="text-overline uppercase tracking-wider text-text-secondary block">
                  Compensado
                </span>
                <span className="text-xs text-text-secondary">
                  Esta linha e a compra que ela cancela estão fora de todos os totais.
                </span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                loading={undoing}
                onClick={() => void desfazer()}
              >
                Desfazer
              </Button>
            </div>

            {/* A outra ponta, nomeada. Sem isto a faixa diz que houve uma
                compensação sem dizer com o quê — e conferir exigiria caçar a
                compra na lista. */}
            {contraparte && (
              <div className="pt-3 border-t border-border flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <span className="text-overline uppercase tracking-wider text-text-secondary block">
                    {ehOEstorno ? "Cancela a compra" : "Estornada pelo crédito"}
                  </span>
                  <span className="text-xs font-semibold text-text-primary block truncate">
                    {contraparte.description}
                  </span>
                  <span className="text-[11px] text-text-secondary">
                    {contraparte.detalhe}
                  </span>
                </div>
                <span
                  className={`font-display font-bold text-sm shrink-0 tnum ${
                    ehOEstorno ? "text-expense" : "text-income"
                  }`}
                >
                  {ehOEstorno ? "- " : "+ "}
                  <Money value={contraparte.valor} />
                </span>
              </div>
            )}
          </div>
        ) : (
          transaction.type === "INCOME" && (
            <button
              type="button"
              onClick={() => setIsCompensationOpen(true)}
              className="w-full p-3.5 rounded-card bg-surface-alt/60 border border-border hover:border-border-strong focus-ring cursor-pointer text-left transition-[border-color,box-shadow] duration-150 flex items-center justify-between gap-3"
            >
              <span className="min-w-0">
                <span className="text-xs font-semibold text-text-primary block">
                  Compensar compra parcelada
                </span>
                <span className="text-[11px] text-text-secondary">
                  Ligue este crédito às parcelas da compra estornada.
                </span>
              </span>
              <span className="text-xs font-semibold text-primary shrink-0">Escolher</span>
            </button>
          )
        )}

        {/* Observações */}
        <Field id="tx-note" label="Observações (opcional)">
          <Input
            id="tx-note"
            placeholder="Ex: Identificação pessoal, nota fiscal..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
      </form>

      <CompensationModal
        isOpen={isCompensationOpen}
        onClose={() => setIsCompensationOpen(false)}
        transactionId={transaction.id}
        onDone={() => {
          onReload?.();
          onClose();
        }}
      />
    </Modal>
  );
}



