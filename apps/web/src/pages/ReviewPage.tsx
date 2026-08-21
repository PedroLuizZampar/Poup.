import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { SuggestionDTO } from "@poup/shared";
import { applySuggestions, dismissSuggestions, fetchSuggestions } from "../lib/api";
import { notifySuggestionsChanged } from "../hooks/useSuggestionsCount";
import { useCategories, type CategoryMap } from "../hooks/useCategories";
import { CategorySelectModal } from "../components/categories/CategorySelectModal";
import { SimilarTransactionsModal } from "../components/transactions/SimilarTransactionsModal";
import { EmptyState } from "../components/common/EmptyState";
import { Button } from "../components/ui/Button";
import { CategoryTile } from "../components/ui/CategoryTile";
import { useConfirm } from "../components/ui/ConfirmDialog";
import { formatDate } from "../lib/format";
import { Money } from "../components/ui/Money";

const SOURCE_LABEL: Record<SuggestionDTO["source"], string> = {
  HISTORY: "porque você já categorizou transações parecidas assim",
  RULE: "pelo nome do estabelecimento",
  PLUGGY: "pela categoria informada pelo banco",
  // Nunca é lido: as sem palpite formam o grupo final, que tem seu próprio
  // texto — ele explica a ausência em vez de completar a frase "sugeridas ...".
  NONE: "",
};

interface Grupo {
  /** Null é o grupo final: transação que o app não adivinhou. */
  categoryId: string | null;
  itens: SuggestionDTO[];
}

/**
 * A fila crua vira páginas: uma por categoria sugerida.
 *
 * Ordem por tamanho: a página de dez transações resolve dez com um toque, e
 * começar por ela é o que faz a fila encolher mais rápido. "Sem categoria
 * definida" fica sempre por último — é a única página que exige escolher do
 * zero, e quem cansa no meio cansa tendo resolvido o barato primeiro.
 */
function agrupar(suggestions: SuggestionDTO[], categoryMap: CategoryMap): Grupo[] {
  const porCategoria = new Map<string, SuggestionDTO[]>();
  const semPalpite: SuggestionDTO[] = [];

  for (const sugestao of suggestions) {
    if (!sugestao.suggestedCategoryId) {
      semPalpite.push(sugestao);
      continue;
    }
    const atual = porCategoria.get(sugestao.suggestedCategoryId);
    if (atual) atual.push(sugestao);
    else porCategoria.set(sugestao.suggestedCategoryId, [sugestao]);
  }

  const grupos: Grupo[] = Array.from(porCategoria, ([categoryId, itens]) => ({
    categoryId,
    itens,
  })).sort(
    (a, b) =>
      b.itens.length - a.itens.length ||
      (categoryMap[a.categoryId!]?.name ?? "").localeCompare(
        categoryMap[b.categoryId!]?.name ?? ""
      )
  );

  if (semPalpite.length > 0) {
    grupos.push({ categoryId: null, itens: semPalpite });
  }

  return grupos;
}

/** Descrição, data, conta e valor — o miolo de qualquer linha da revisão. */
function Dados({ sugestao }: { sugestao: SuggestionDTO }) {
  const tx = sugestao.transaction;
  return (
    <>
      <span className="flex-1 min-w-0">
        <span className="block text-sm text-text-primary truncate">{tx.description}</span>
        <span className="block text-xs text-text-secondary">
          {formatDate(tx.date)} · {tx.accountName}
        </span>
      </span>
      <span
        className={`font-display font-bold text-sm shrink-0 tnum ${
          tx.type === "INCOME" ? "text-income" : "text-expense"
        }`}
      >
        {tx.type === "INCOME" ? "+ " : "- "}
        <Money value={tx.amount} />
      </span>
    </>
  );
}

/** Página com palpite: a decisão é coletiva, e a caixa é o que se desmarca. */
function LinhaMarcavel({
  sugestao,
  checked,
  onToggle,
}: {
  sugestao: SuggestionDTO;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label className="tap-target flex items-center gap-3 px-3 py-2.5 rounded-ctl hover:bg-surface-alt cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="w-4 h-4 shrink-0 accent-primary"
      />
      <Dados sugestao={sugestao} />
    </label>
  );
}

/**
 * Página final: a decisão é uma de cada vez, como em Transações — tocar na
 * linha abre o seletor, e o que vier depois são as parecidas.
 */
function LinhaManual({
  sugestao,
  onClick,
  disabled,
}: {
  sugestao: SuggestionDTO;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="tap-target flex items-center gap-3 w-full text-left px-3 py-2.5 rounded-ctl hover:bg-surface-alt focus-ring transition-colors disabled:opacity-50"
    >
      <Dados sugestao={sugestao} />
      <span className="text-xs font-semibold text-primary shrink-0">Categorizar</span>
    </button>
  );
}

export function ReviewPage() {
  const { categories, categoryMap } = useCategories();
  const confirm = useConfirm();
  const [suggestions, setSuggestions] = useState<SuggestionDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  /** Só na página final: a linha que abriu o seletor. */
  const [manual, setManual] = useState<SuggestionDTO | null>(null);
  const [parecidas, setParecidas] = useState<{
    transactionId: string;
    categoryId: string;
  } | null>(null);

  async function recarregar() {
    try {
      const data = await fetchSuggestions();
      setSuggestions(data.suggestions);
    } catch (err) {
      console.error("Erro ao carregar sugestões:", err);
    }
  }

  useEffect(() => {
    void (async () => {
      await recarregar();
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const grupos = useMemo(() => agrupar(suggestions, categoryMap), [suggestions, categoryMap]);

  // Sempre a primeira página. Confirmar um lote reavalia o resto no servidor —
  // o que sobra pode ter mudado de categoria, e um índice guardado apontaria
  // para uma página que não existe mais.
  const grupo = grupos[0] ?? null;

  // Depende do conteúdo da página, não da identidade do objeto: as categorias
  // chegam depois da fila e reordenam os grupos, e reagir a isso apagaria as
  // marcas de quem já começou a desmarcar.
  const assinatura = grupo
    ? `${grupo.categoryId ?? ""}:${grupo.itens.map((item) => item.id).join(",")}`
    : "";

  useEffect(() => {
    if (!grupo) return;
    // Com palpite, tudo pré-marcado: a página existe para você tirar o que não
    // é, não para marcar o que é.
    setSelecionadas(grupo.categoryId ? new Set(grupo.itens.map((item) => item.id)) : new Set());
    window.scrollTo({ top: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assinatura]);

  function toggle(id: string) {
    setSelecionadas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleTodas() {
    if (!grupo) return;
    setSelecionadas((prev) =>
      prev.size === grupo.itens.length ? new Set() : new Set(grupo.itens.map((i) => i.id))
    );
  }

  /** Confirma a página de uma categoria sugerida. */
  async function confirmar() {
    if (!grupo?.categoryId || saving) return;
    setSaving(true);
    try {
      const data = await applySuggestions({
        categoryId: grupo.categoryId,
        acceptIds: grupo.itens.filter((i) => selecionadas.has(i.id)).map((i) => i.id),
        // Desmarcar aqui é recusar o palpite: a transação continua na fila, mas
        // sem sugestão, e reaparece na página final.
        rejectIds: grupo.itens.filter((i) => !selecionadas.has(i.id)).map((i) => i.id),
      });
      setSuggestions(data.suggestions);
      notifySuggestionsChanged();
    } catch (err) {
      console.error("Erro ao categorizar o lote:", err);
    } finally {
      setSaving(false);
    }
  }

  /**
   * Página final: categoriza uma e emenda nas parecidas, como em Transações.
   * Uma escolha manual costuma valer por várias — é a que ensina o motor.
   */
  async function categorizarUma(sugestao: SuggestionDTO, categoryId: string) {
    if (saving) return;
    setSaving(true);
    try {
      // A fila que a resposta traz é descartada de propósito: enquanto o modal
      // de parecidas está aberto, trocar as páginas por baixo dele seria puxar
      // o tapete no meio da decisão. Ela é relida quando o modal sai — e aí já
      // inclui o que foi aplicado em massa lá dentro.
      await applySuggestions({ categoryId, acceptIds: [sugestao.id], rejectIds: [] });
      notifySuggestionsChanged();
      setParecidas({ transactionId: sugestao.transaction.id, categoryId });
    } catch (err) {
      console.error("Erro ao categorizar a transação:", err);
    } finally {
      setSaving(false);
    }
  }

  function fecharParecidas() {
    setParecidas(null);
    void recarregar();
  }

  /** A saída para o que você não quer decidir: some da fila, não da conta. */
  async function deixarRestantesSemCategoria() {
    if (!grupo || saving) return;
    const quantas = grupo.itens.length;
    const ok = await confirm({
      title: "Deixar sem categoria?",
      message: `${quantas} ${
        quantas === 1 ? "transação sai da revisão" : "transações saem da revisão"
      } e ${quantas === 1 ? "continua" : "continuam"} sem categoria. Você ainda pode categorizar ${
        quantas === 1 ? "ela" : "elas"
      } em Transações.`,
      confirmText: "Deixar sem categoria",
    });
    if (!ok) return;

    setSaving(true);
    try {
      const data = await dismissSuggestions(grupo.itens.map((i) => i.id));
      setSuggestions(data.suggestions);
      notifySuggestionsChanged();
    } catch (err) {
      console.error("Erro ao dispensar sugestões:", err);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="text-sm text-text-secondary">Carregando sugestões…</div>;
  }

  if (!grupo) {
    return (
      <div className="flex flex-col gap-6 anim-fade-up">
        <h1 className="text-display-xl font-display font-extrabold text-text-primary">
          Revisar categorias
        </h1>
        <EmptyState
          title="Nada para revisar"
          description="Assim que chegarem transações novas sem categoria, elas aparecem aqui — agrupadas pela categoria que o app sugeriu."
          action={
            <Link to="/transacoes">
              <Button variant="primary">Ver transações</Button>
            </Link>
          }
        />
      </div>
    );
  }

  const semPalpite = grupo.categoryId === null;
  const categoria = grupo.categoryId ? categoryMap[grupo.categoryId] : undefined;
  // A origem só vira frase quando vale para o grupo inteiro; um lote que
  // misturou histórico e palavra-chave não tem um "porque" só.
  const origem = grupo.itens.every((i) => i.source === grupo.itens[0].source)
    ? SOURCE_LABEL[grupo.itens[0].source]
    : "";
  const marcadas = selecionadas.size;

  return (
    <div className="flex flex-col gap-6 anim-fade-up">
      <div className="flex flex-row items-start justify-between gap-4">
        <h1 className="text-display-xl font-display font-extrabold text-text-primary">
          Revisar categorias
        </h1>
        <span className="text-sm text-text-secondary shrink-0 mt-1">
          {grupos.length} {grupos.length === 1 ? "categoria" : "categorias"} · {suggestions.length}{" "}
          {suggestions.length === 1 ? "transação" : "transações"}
        </span>
      </div>

      <div className="bg-surface rounded-panel p-5 shadow-sh1 border border-border flex flex-col gap-4">
        <div className="flex items-start gap-3">
          {semPalpite ? (
            <span
              className="w-[46px] h-[46px] min-w-[46px] rounded-tile border border-dashed border-border-strong text-text-secondary inline-flex items-center justify-center text-lg font-semibold shrink-0"
              aria-hidden="true"
            >
              ?
            </span>
          ) : (
            <CategoryTile icon={categoria?.icon} colorKey={categoria?.colorKey} size="lg" />
          )}
          <div className="flex flex-col gap-0.5 min-w-0">
            <h2 className="text-lg font-semibold text-text-primary break-words">
              {semPalpite ? "Sem categoria definida" : categoria?.name ?? "Categoria removida"}
            </h2>
            <p className="text-xs text-text-secondary">
              {semPalpite
                ? "O app não arriscou um palpite para estas. Categorize uma e ele oferece as parecidas — a cada escolha ele reconhece mais das que sobraram."
                : `${grupo.itens.length} ${
                    grupo.itens.length === 1 ? "transação sugerida" : "transações sugeridas"
                  }${origem ? ` ${origem}` : ""}. Desmarque o que não for.`}
            </p>
          </div>
        </div>

        {!semPalpite && (
          <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
            <span className="text-xs text-text-secondary">
              {marcadas} de {grupo.itens.length} {marcadas === 1 ? "marcada" : "marcadas"}
            </span>
            <button
              type="button"
              onClick={toggleTodas}
              className="tap-target text-xs font-semibold text-primary hover:underline focus-ring rounded-ctl px-2"
            >
              {marcadas === grupo.itens.length ? "Desmarcar todas" : "Marcar todas"}
            </button>
          </div>
        )}

        <div className={`flex flex-col gap-1 -mx-2 ${semPalpite ? "border-t border-border pt-3" : ""}`}>
          {grupo.itens.map((sugestao) =>
            semPalpite ? (
              <LinhaManual
                key={sugestao.id}
                sugestao={sugestao}
                disabled={saving}
                onClick={() => setManual(sugestao)}
              />
            ) : (
              <LinhaMarcavel
                key={sugestao.id}
                sugestao={sugestao}
                checked={selecionadas.has(sugestao.id)}
                onToggle={() => toggle(sugestao.id)}
              />
            )
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          {semPalpite ? (
            <Button
              variant="ghost"
              onClick={() => void deixarRestantesSemCategoria()}
              disabled={saving}
              fullWidth
            >
              Deixar {grupo.itens.length === 1 ? "esta" : `as ${grupo.itens.length}`} sem categoria
            </Button>
          ) : (
            <Button variant="primary" onClick={() => void confirmar()} loading={saving} fullWidth>
              {/* Confirmar sem nada marcado é uma resposta legítima: significa
                  "nenhuma destas é desta categoria", e todas caem na última
                  página. */}
              {marcadas === 0
                ? `Nenhuma é ${categoria?.name ?? "desta categoria"}`
                : `Categorizar ${marcadas}`}
            </Button>
          )}
        </div>
      </div>

      <CategorySelectModal
        isOpen={manual !== null}
        onClose={() => setManual(null)}
        categories={categories}
        selectedCategoryId={null}
        onSelectCategory={(id) => {
          const sugestao = manual;
          setManual(null);
          if (id && sugestao) void categorizarUma(sugestao, id);
        }}
        title="Escolher categoria"
        allowUncategorized={false}
      />

      {parecidas && (
        <SimilarTransactionsModal
          isOpen
          onClose={fecharParecidas}
          transactionId={parecidas.transactionId}
          categoryId={parecidas.categoryId}
          categoryMap={categoryMap}
        />
      )}
    </div>
  );
}
