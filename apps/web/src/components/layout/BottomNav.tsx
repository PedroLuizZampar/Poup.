import React, { ComponentType, SVGProps } from "react";
import { NavLink } from "react-router-dom";
import type { UserDTO } from "@poup/shared";
import {
  HomeIcon,
  TransferIcon,
  TargetIcon,
  ChartIcon,
} from "../icons/Icons";
import { UserAvatar } from "../ui/UserAvatar";

interface BottomNavProps {
  user: UserDTO;
}

interface Tab {
  label: string;
  path: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}

/**
 * Cinco abas é o teto antes de os rótulos truncarem em 360px — a régua que
 * decidiu quem fica. Categorias fica de fora e vira uma entrada dentro de
 * Perfil: categorizar uma transação já acontece no modal de detalhe, e a página
 * de Categorias é manutenção de configuração, não tarefa diária.
 */
const TABS: Tab[] = [
  { label: "Início", path: "/", icon: HomeIcon },
  { label: "Transações", path: "/transacoes", icon: TransferIcon },
  { label: "Planejamento", path: "/planejamento", icon: TargetIcon },
  { label: "Relatórios", path: "/relatorios", icon: ChartIcon },
];

const TAB_CLASSES =
  "relative flex flex-col items-center justify-center gap-0.5 h-full min-w-[56px] px-0.5 focus-ring rounded-tile transition-colors";

/** O rótulo trunca em vez de vazar: abaixo de 360px "Planejamento" não cabe. */
const LABEL_CLASSES = "text-caption leading-none w-full text-center truncate px-0.5";

/** Barrinha de aba ativa — a mesma do header no desktop, virada para cima. */
function ActiveIndicator() {
  return (
    <span
      className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-primary rounded-full anim-scale-in"
      aria-hidden="true"
    />
  );
}

/**
 * Navegação principal do mobile.
 *
 * Abaixo de 768px o `<nav>` do header desaparecia e nada o substituía: as rotas
 * só eram alcançáveis digitando a URL. Esta barra é a resposta — e some a
 * partir de `md`, onde a navegação do header volta a existir.
 */
export function BottomNav({ user }: BottomNavProps) {
  return (
    <nav
      aria-label="Navegação principal"
      className="md:hidden fixed inset-x-0 bottom-0 z-40 bg-surface/95 backdrop-blur-md border-t border-border shadow-sh2 pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]"
    >
      <div className="h-[var(--nav-h)] grid grid-cols-5">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <NavLink
              key={tab.path}
              to={tab.path}
              end={tab.path === "/"}
              className={({ isActive }) =>
                `${TAB_CLASSES} ${
                  isActive
                    ? "text-primary"
                    : "text-text-secondary active:bg-surface-alt"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && <ActiveIndicator />}
                  <Icon className="w-6 h-6 shrink-0" aria-hidden="true" />
                  <span
                    className={`${LABEL_CLASSES} ${
                      isActive ? "font-bold" : "font-medium"
                    }`}
                  >
                    {tab.label}
                  </span>
                </>
              )}
            </NavLink>
          );
        })}

        {/* Perfil usa a própria foto no lugar do ícone: é o destino em que o
            usuário se procura, e o rosto identifica mais rápido que um glifo. */}
        <NavLink
          to="/perfil"
          className={({ isActive }) =>
            `${TAB_CLASSES} ${
              isActive ? "text-primary" : "text-text-secondary active:bg-surface-alt"
            }`
          }
        >
          {({ isActive }) => (
            <>
              {isActive && <ActiveIndicator />}
              <UserAvatar
                name={user.name}
                avatarUrl={user.avatarUrl}
                size="xs"
                className={isActive ? "ring-2 ring-primary" : ""}
              />
              <span
                className={`${LABEL_CLASSES} ${
                  isActive ? "font-bold" : "font-medium"
                }`}
              >
                Perfil
              </span>
            </>
          )}
        </NavLink>
      </div>
    </nav>
  );
}
