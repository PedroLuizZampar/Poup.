import { useEffect, useState } from "react";
import type { UserDTO } from "@poup/shared";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { fetchMe, getToken } from "./lib/api";
import { LoginPage } from "./pages/LoginPage";
import { SignupPage } from "./pages/SignupPage";
import { OnboardingPage } from "./pages/OnboardingPage";
import { AppLayout } from "./components/layout/AppLayout";
import { DashboardPage } from "./pages/DashboardPage";
import { TransactionsPage } from "./pages/TransactionsPage";
import { CategoriesPage } from "./pages/CategoriesPage";
import { PlanningPage } from "./pages/PlanningPage";
import { ReportsPage } from "./pages/ReportsPage";
import { ProfilePage } from "./pages/ProfilePage";
import { ThemeProvider } from "./context/ThemeContext";
import { ToastProvider } from "./components/ui/Toast";
import { ConfirmProvider } from "./components/ui/ConfirmDialog";
import { OfflineScreen } from "./components/common/OfflineScreen";
import { UpdateBanner } from "./components/common/UpdateBanner";

/**
 * A flag de onboarding é por usuário, e não da máquina.
 *
 * Enquanto o app tinha um usuário só, uma chave global bastava. Com cadastro
 * aberto, ela fazia duas coisas erradas: o segundo usuário da mesma máquina
 * nunca via a apresentação, e quem abria o app pela primeira vez via os slides
 * antes de saber o que o app é — porque o onboarding vinha antes do login.
 */
function onboardingKey(userId: string): string {
  return `poup:onboarding_completed:${userId}`;
}

export function App() {
  const [user, setUser] = useState<UserDTO | null>(null);
  const [checking, setChecking] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [authScreen, setAuthScreen] = useState<"login" | "signup">("login");
  /**
   * Há sessão salva, mas não deu para confirmá-la: o servidor não respondeu.
   * Isto **não** é "não está logado" — mandar essa pessoa para a tela de login
   * seria mentir sobre o motivo e ainda pedir a senha para nada.
   */
  const [semResposta, setSemResposta] = useState(false);

  function verificarSessao() {
    if (!getToken()) {
      setChecking(false);
      return;
    }
    setChecking(true);
    setSemResposta(false);
    fetchMe()
      .then((u) => setUser(u))
      .catch(() => setSemResposta(true))
      .finally(() => setChecking(false));
  }

  useEffect(verificarSessao, []);

  useEffect(() => {
    if (!user) {
      setShowOnboarding(false);
      return;
    }
    setShowOnboarding(localStorage.getItem(onboardingKey(user.id)) !== "true");
  }, [user]);

  function handleFinishOnboarding() {
    if (user) {
      localStorage.setItem(onboardingKey(user.id), "true");
    }
    setShowOnboarding(false);
  }

  return (
    <ThemeProvider>
      <ToastProvider>
        <ConfirmProvider>
          {checking ? (
            <div className="min-h-dvh flex items-center justify-center bg-bg">
              <div className="flex flex-col items-center gap-3">
                <div className="w-10 h-10 border-4 border-primary-soft border-t-primary rounded-full animate-spin" />
                <span className="font-display font-bold text-sm text-primary">Carregando Poup...</span>
              </div>
            </div>
          ) : semResposta ? (
            <OfflineScreen onRetry={verificarSessao} />
          ) : !user ? (
            authScreen === "signup" ? (
              <SignupPage
                onSignedUp={() => {
                  fetchMe().then((u) => setUser(u));
                }}
                onGoToLogin={() => setAuthScreen("login")}
              />
            ) : (
              <LoginPage
                onLoggedIn={() => {
                  fetchMe().then((u) => setUser(u));
                }}
                onGoToSignup={() => setAuthScreen("signup")}
              />
            )
          ) : showOnboarding ? (
            <OnboardingPage onFinish={handleFinishOnboarding} />
          ) : (
            <BrowserRouter>
              <Routes>
                <Route element={<AppLayout user={user} onLoggedOut={() => setUser(null)} />}>
                  <Route path="/" element={<DashboardPage />} />
                  <Route path="/transacoes" element={<TransactionsPage />} />
                  <Route path="/categorias" element={<CategoriesPage />} />
                  <Route path="/planejamento" element={<PlanningPage />} />
                  <Route path="/relatorios" element={<ReportsPage />} />
                  <Route
                    path="/perfil"
                    element={
                      <ProfilePage
                        user={user}
                        onUserUpdated={setUser}
                        onLoggedOut={() => setUser(null)}
                      />
                    }
                  />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Route>
              </Routes>
            </BrowserRouter>
          )}
          <UpdateBanner />
        </ConfirmProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
