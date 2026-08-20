import React from "react";
import { EmptyState } from "./EmptyState";
import { WifiOffIcon } from "../icons/Icons";
import { Logo } from "../icons/Logo";

/**
 * O que o app mostra quando abre sem rede.
 *
 * Instalado na tela de início, o Poup promete ser um app: tocar no ícone e
 * receber uma página em branco — ou o erro cru de `fetch` — é a pior forma de
 * descobrir que não há sinal. A casca vem do cache do service worker, então
 * esta tela sempre aparece; o que ela **não** faz é inventar saldo: dinheiro
 * servido do cache sem aviso parece atual e não é.
 */
export function OfflineScreen({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center bg-bg text-text-primary p-6 anim-fade-in">
      <div className="flex items-center gap-2.5 mb-8">
        <Logo className="w-7 h-7 text-primary" />
        <span className="font-display font-extrabold text-2xl tracking-tight">
          Poup<span className="text-primary">.</span>
        </span>
      </div>

      <EmptyState
        icon={WifiOffIcon}
        title="Você está sem conexão"
        description="O app abriu, mas não consegue falar com o servidor. Seus dados financeiros vêm do servidor a cada abertura — nada aqui é mostrado de memória para não te dar um saldo desatualizado sem avisar."
        action={{ label: "Tentar de novo", onClick: onRetry }}
      />
    </div>
  );
}

/**
 * Faixa fina para a queda de conexão com o app já aberto. Diferente da tela
 * acima, aqui há conteúdo na frente do usuário — o aviso informa sem tomar a
 * tela, mas deixa claro que o que está na tela pode ter envelhecido.
 */
export function OfflineBanner() {
  return (
    <div
      role="status"
      className="sticky top-[var(--header-h)] z-30 bg-warning-soft border-b border-warning/30 text-warning px-4 sm:px-6 md:px-12 py-2 flex items-center justify-center gap-2 text-xs font-semibold anim-fade-down"
    >
      <WifiOffIcon className="w-4 h-4 shrink-0" aria-hidden="true" />
      Sem conexão. Os números na tela podem estar desatualizados.
    </div>
  );
}
