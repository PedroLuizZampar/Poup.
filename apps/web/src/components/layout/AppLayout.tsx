import React, { useState, useEffect, useRef } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Logo } from "../icons/Logo";
import { BellIcon, SunIcon, MoonIcon } from "../icons/Icons";
import { NotificationDrawer } from "../notifications/NotificationDrawer";
import { BottomNav } from "./BottomNav";
import { fetchNotifications, clearToken } from "../../lib/api";
import { UserAvatar } from "../ui/UserAvatar";
import type { UserDTO } from "@poup/shared";
import { useTheme } from "../../context/ThemeContext";

export function AppLayout({
  user,
  onLoggedOut,
}: {
  user: UserDTO;
  onLoggedOut: () => void;
}) {
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchNotifications()
      .then((data) => setUnreadCount(data.unreadCount))
      .catch(() => {});
  }, []);

  // Fecha menu de usuário em clique externo
  useEffect(() => {
    if (!isUserMenuOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setIsUserMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isUserMenuOpen]);

  const navItems = [
    { label: "Início", path: "/" },
    { label: "Transações", path: "/transacoes" },
    { label: "Categorias", path: "/categorias" },
    { label: "Planejamento", path: "/planejamento" },
    { label: "Relatórios", path: "/relatorios" },
    { label: "Perfil", path: "/perfil" },
  ];

  return (
    <div className="min-h-dvh flex flex-col bg-bg text-text-primary">
      {/* Topbar. Abaixo de `md` ela encolhe para 56px e guarda só o essencial:
          navegar é trabalho da barra inferior, e o tema mudou-se para o Perfil. */}
      <header className="h-[var(--header-h)] flex-none bg-surface border-b border-border px-4 sm:px-6 md:px-12 flex items-center justify-between sticky top-0 z-40 transition-colors duration-150">
        <div className="flex items-center gap-10">
          {/* Logo */}
          <NavLink to="/" className="flex items-center gap-2.5 group focus-ring rounded-lg">
            <Logo className="w-6 h-6 text-primary group-hover:scale-105 transition-transform" />
            <span className="font-display font-extrabold text-xl tracking-tight">
              Poup<span className="text-primary">.</span>
            </span>
          </NavLink>

          {/* Navigation Links */}
          <nav className="hidden md:flex items-center gap-2">
            {navItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === "/"}
                className={({ isActive }) =>
                  `relative px-3.5 py-2 rounded-ctl text-body transition-colors focus-ring ${
                    isActive
                      ? "font-semibold text-primary"
                      : "font-medium text-text-secondary hover:text-text-primary hover:bg-surface-alt"
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <span>{item.label}</span>
                    {isActive && (
                      <span className="absolute bottom-0 left-3.5 right-3.5 h-0.5 bg-primary rounded-full anim-scale-in" />
                    )}
                  </>
                )}
              </NavLink>
            ))}
          </nav>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-2 sm:gap-3 md:gap-4 relative">
          {/* Alternar tema. Só no desktop: no mobile o controle vive na seção
              "Aparência" do Perfil, onde ele cabe com rótulo e alvo de toque. */}
          <button
            type="button"
            onClick={toggleTheme}
            className="hidden md:flex w-10 h-10 rounded-full bg-surface-alt items-center justify-center text-text-secondary hover:text-text-primary hover:bg-surface-sunken transition-colors focus-ring cursor-pointer"
            title={theme === "dark" ? "Mudar para modo claro" : "Mudar para modo escuro"}
            aria-label="Alternar tema"
          >
            {theme === "dark" ? (
              <SunIcon className="w-5 h-5" />
            ) : (
              <MoonIcon className="w-5 h-5" />
            )}
          </button>

          {/* Notification Bell */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsNotifOpen(!isNotifOpen)}
              className="w-10 h-10 rounded-full bg-surface-alt flex items-center justify-center relative text-text-primary hover:bg-surface-sunken transition-colors focus-ring cursor-pointer"
              title="Notificações"
              aria-label="Abrir notificações"
            >
              <BellIcon className="w-5 h-5" />
              {unreadCount > 0 && (
                <span className="absolute top-1.5 right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-error text-white text-[10px] font-bold flex items-center justify-center border-2 border-surface tnum">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>

            {/* Notification Drawer Popover */}
            <NotificationDrawer
              isOpen={isNotifOpen}
              onClose={() => setIsNotifOpen(false)}
              onUpdateUnread={(count) => setUnreadCount(count)}
            />
          </div>

          {/* Avatar e menu do usuário. No mobile o avatar já é a aba Perfil da
              barra inferior — repeti-lo aqui seria a mesma foto duas vezes numa
              tela de 360px, e o dropdown não teria alvo de toque decente. */}
          <div ref={userMenuRef} className="relative hidden md:block">
            <button
              type="button"
              onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
              title={`${user.name} (${user.email})`}
              aria-label="Menu do usuário"
              aria-expanded={isUserMenuOpen}
              aria-haspopup="menu"
              className="rounded-full cursor-pointer hover:opacity-90 transition-opacity focus-ring"
            >
              <UserAvatar name={user.name} avatarUrl={user.avatarUrl} size="md" />
            </button>

            {isUserMenuOpen && (
              <div className="absolute right-0 mt-2 w-48 rounded-card bg-surface p-1.5 shadow-sh3 border border-border anim-fade-down z-50">
                <div className="px-3 py-2 border-b border-border/60 mb-1">
                  <p className="text-xs font-bold text-text-primary truncate">{user.name}</p>
                  <p className="text-[11px] text-text-secondary truncate">{user.email}</p>
                </div>
                <NavLink
                  to="/perfil"
                  onClick={() => setIsUserMenuOpen(false)}
                  className="flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-tile text-text-primary hover:bg-surface-alt transition-colors focus-ring"
                >
                  Perfil
                </NavLink>
                <button
                  type="button"
                  onClick={() => {
                    setIsUserMenuOpen(false);
                    clearToken();
                    onLoggedOut();
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-tile text-error hover:bg-error-soft transition-colors focus-ring cursor-pointer text-left"
                >
                  Sair
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Area com chave para animação de transição.
          O `pb` desconta a barra inferior e a safe area para o conteúdo não
          terminar embaixo dela — `--nav-h` é 0 a partir de `md`. */}
      <main
        key={location.pathname}
        className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 md:px-12 py-6 md:py-8 pb-[calc(var(--nav-h)+env(safe-area-inset-bottom)+1.5rem)] md:pb-8 anim-fade-up"
      >
        <Outlet context={{ user }} />
      </main>

      <BottomNav user={user} />
    </div>
  );
}
