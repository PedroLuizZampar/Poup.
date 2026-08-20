import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";

/**
 * Fontes servidas pela própria origem, e não pelo CDN do Google.
 *
 * O `<link>` que estava no `index.html` bloqueava o primeiro paint e, num app
 * que promete funcionar offline, era fonte que nunca carregaria: o service
 * worker não faz precache de recurso de outro domínio.
 *
 * Os imports são por subset e não por peso inteiro: `500.css` traz cirílico,
 * grego e vietnamita junto, e num app pt-BR isso é meio megabyte de precache
 * que ninguém vai ler. Manrope fica no latino — display, títulos e números, um
 * repertório que a gente controla. Inter leva latin-ext também, porque é nela
 * que caem nomes digitados pelo usuário e de instituições.
 */
import "@fontsource/manrope/latin-500.css";
import "@fontsource/manrope/latin-600.css";
import "@fontsource/manrope/latin-700.css";
import "@fontsource/manrope/latin-800.css";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-ext-400.css";
import "@fontsource/inter/latin-ext-500.css";
import "@fontsource/inter/latin-ext-600.css";

import "./index.css";

// Importado pelo efeito colateral: o `beforeinstallprompt` dispara cedo, e o
// listener precisa já estar de pé quando isso acontecer.
import "./lib/pwa";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
