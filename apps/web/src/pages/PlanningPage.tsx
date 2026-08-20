import React, { useState, useEffect } from "react";
import type { BudgetDTO, GoalDTO, CategoryDTO, AccountDTO } from "@poup/shared";
import {
  fetchBudgets,
  fetchGoals,
  fetchCategories,
  fetchAccounts,
} from "../lib/api";
import { BudgetsTab } from "../components/budgets/BudgetsTab";
import { GoalsTab } from "../components/budgets/GoalsTab";

export function PlanningPage() {
  const [activeTab, setActiveTab] = useState<"budgets" | "goals">("budgets");
  const [budgets, setBudgets] = useState<BudgetDTO[]>([]);
  const [goals, setGoals] = useState<GoalDTO[]>([]);
  const [categories, setCategories] = useState<CategoryDTO[]>([]);
  const [accounts, setAccounts] = useState<AccountDTO[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadData() {
    try {
      setLoading(true);
      const [bData, gData, cData, aData] = await Promise.all([
        fetchBudgets().catch(() => []),
        fetchGoals().catch(() => []),
        fetchCategories().catch(() => []),
        fetchAccounts().catch(() => []),
      ]);
      setBudgets(bData);
      setGoals(gData);
      setCategories(cData);
      setAccounts(aData);
    } catch (err) {
      console.error("Erro ao carregar dados de planejamento:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  return (
    <div className="flex flex-col gap-6 anim-fade-up">
      {/* Header */}
      <div>
        <h1 className="text-display-xl font-display font-extrabold text-text-primary">
          Planejamento
        </h1>
        <p className="text-xs md:text-sm text-text-secondary mt-0.5">
          Defina limites de gastos e acompanhe metas de economia
        </p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-border">
        <button
          type="button"
          onClick={() => setActiveTab("budgets")}
          className={`min-h-ctl pb-3 px-4 font-display text-xs md:text-sm font-bold border-b-2 transition-all cursor-pointer focus-ring ${
            activeTab === "budgets"
              ? "border-primary text-primary"
              : "border-transparent text-text-secondary hover:text-text-primary"
          }`}
        >
          Orçamentos ({budgets.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("goals")}
          className={`min-h-ctl pb-3 px-4 font-display text-xs md:text-sm font-bold border-b-2 transition-all cursor-pointer focus-ring ${
            activeTab === "goals"
              ? "border-primary text-primary"
              : "border-transparent text-text-secondary hover:text-text-primary"
          }`}
        >
          Metas ({goals.length})
        </button>
      </div>

      {/* Conteúdo das Abas */}
      {activeTab === "budgets" && (
        <BudgetsTab
          budgets={budgets}
          categories={categories}
          loading={loading}
          onRefresh={loadData}
        />
      )}

      {activeTab === "goals" && (
        <GoalsTab
          goals={goals}
          accounts={accounts}
          loading={loading}
          onRefresh={loadData}
        />
      )}
    </div>
  );
}

