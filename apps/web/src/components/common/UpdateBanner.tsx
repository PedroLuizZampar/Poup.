import React, { useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { Button } from "../ui/Button";
import { RefreshIcon, CloseIcon } from "../icons/Icons";

/**
 * Registra o service worker e avisa quando há versão nova.
 *
 * Em `autoUpdate` o Workbox baixa e ativa a versão nova sozinho e, sem
 * `onNeedReload`, chama `location.reload()` na cara do usuário — no meio de um
 * formulário isso apaga o que estava sendo digitado. Interceptar o gancho troca
 * o ato por um convite: a versão nova já está instalada, só falta a página
 * recarregar, e quem decide quando é quem está usando.
 *
 * `needRefresh` do hook não serve aqui: ele só é acionado no modo `prompt`.
 */
export function UpdateBanner() {
  const [precisaRecarregar, setPrecisaRecarregar] = useState(false);
  const [dispensado, setDispensado] = useState(false);

  useRegisterSW({
    onNeedReload() {
      setPrecisaRecarregar(true);
    },
    onRegisterError(erro) {
      // Silenciar isto esconde a diferença entre "o app não é instalável" e
      // "o service worker quebrou" — que é o primeiro lugar a olhar quando o
      // offline não funciona.
      console.error("Falha ao registrar o service worker do Poup:", erro);
    },
  });

  if (!precisaRecarregar || dispensado) return null;

  return (
    <div
      role="status"
      className="fixed z-50 inset-x-4 bottom-[calc(var(--nav-h)+env(safe-area-inset-bottom)+1rem)] sm:inset-x-auto sm:right-5 sm:max-w-sm sm:w-full md:bottom-5 p-4 rounded-card bg-surface border border-primary/30 shadow-sh3 flex items-start gap-3 anim-fade-up"
    >
      <span className="w-8 h-8 rounded-full bg-primary-soft text-primary flex items-center justify-center shrink-0">
        <RefreshIcon className="w-4 h-4" aria-hidden="true" />
      </span>

      <div className="flex-1 min-w-0">
        <h4 className="text-sm font-semibold text-text-primary">
          Há uma versão nova do Poup.
        </h4>
        <p className="text-xs text-text-secondary mt-0.5 leading-relaxed">
          Recarregue quando terminar o que está fazendo.
        </p>
        <Button
          variant="primary"
          size="sm"
          className="mt-2.5"
          onClick={() => window.location.reload()}
        >
          Recarregar agora
        </Button>
      </div>

      <button
        type="button"
        onClick={() => setDispensado(true)}
        aria-label="Dispensar aviso de atualização"
        className="tap-target w-6 h-6 rounded-full flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-surface-alt transition-colors shrink-0 cursor-pointer focus-ring"
      >
        <CloseIcon className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
