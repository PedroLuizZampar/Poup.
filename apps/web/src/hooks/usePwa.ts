import { useEffect, useState, useSyncExternalStore } from "react";
import { canInstall, isIOS, isStandalone, subscribeToInstallPrompt } from "../lib/pwa";

/**
 * Estado da oferta de instalação, já resolvido para o que a interface precisa
 * decidir: mostrar o botão, mostrar as instruções do iOS, ou não dizer nada.
 */
export function useInstallState() {
  const disponivel = useSyncExternalStore(subscribeToInstallPrompt, canInstall, () => false);
  const [instalado, setInstalado] = useState(isStandalone);

  useEffect(() => {
    const query = window.matchMedia("(display-mode: standalone)");
    function handleChange() {
      setInstalado(isStandalone());
    }
    query.addEventListener("change", handleChange);
    window.addEventListener("appinstalled", handleChange);
    return () => {
      query.removeEventListener("change", handleChange);
      window.removeEventListener("appinstalled", handleChange);
    };
  }, []);

  return {
    instalado,
    /** Há prompt nativo guardado e pronto para abrir. */
    podeInstalar: disponivel && !instalado,
    /** No iOS não existe prompt: resta explicar o caminho manual. */
    precisaDeInstrucoes: isIOS() && !instalado && !disponivel,
  };
}

/**
 * `true` enquanto o navegador se considera conectado.
 *
 * `navigator.onLine` mente para cima — responde "sim" a qualquer interface
 * ativa, mesmo sem internet do outro lado —, mas nunca mente para baixo: um
 * `false` é sempre confiável, e é só disso que a interface precisa para trocar
 * um erro cru de fetch por uma explicação honesta.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine
  );

  useEffect(() => {
    function subiu() {
      setOnline(true);
    }
    function caiu() {
      setOnline(false);
    }
    window.addEventListener("online", subiu);
    window.addEventListener("offline", caiu);
    return () => {
      window.removeEventListener("online", subiu);
      window.removeEventListener("offline", caiu);
    };
  }, []);

  return online;
}
