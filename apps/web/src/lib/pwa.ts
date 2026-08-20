/**
 * Instalação do app na tela de início.
 *
 * O `beforeinstallprompt` dispara cedo — normalmente antes de a página de
 * Perfil, que é onde o botão mora, existir. Por isso o listener é registrado no
 * carregamento deste módulo (importado pelo `main.tsx`) e o evento fica
 * guardado aqui até alguém pedir. Quem chega depois lê o estado atual; quem já
 * está montado é avisado pela assinatura.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    // Sem o `preventDefault` o Chrome mostra a própria faixa, e o botão do
    // Perfil vira o segundo convite para a mesma coisa.
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    notify();
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    notify();
  });
}

export function subscribeToInstallPrompt(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function canInstall(): boolean {
  return deferredPrompt !== null;
}

/** `true` quando o app já está aberto instalado, fora do navegador. */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // O Safari do iOS não implementa `display-mode` e usa este campo próprio.
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

/** `true` no iPhone e no iPad, onde instalar é sempre manual pelo Safari. */
export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS se apresenta como Mac; o toque é o que o denuncia.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/**
 * Abre o diálogo nativo de instalação. Devolve `true` se o usuário aceitou.
 * O evento só serve uma vez: recusado, o navegador decide sozinho quando
 * oferecer de novo.
 */
export async function promptInstall(): Promise<boolean> {
  if (!deferredPrompt) return false;
  const event = deferredPrompt;
  deferredPrompt = null;
  notify();
  await event.prompt();
  const { outcome } = await event.userChoice;
  return outcome === "accepted";
}
