/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Poup. — Finanças pessoais",
        short_name: "Poup.",
        description:
          "Suas finanças pessoais num lugar só: contas conectadas, gastos categorizados, orçamentos e metas.",
        lang: "pt-BR",
        dir: "ltr",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        // Casam com `--bg` e `--primary` do tema claro: é o que o sistema pinta
        // na splash antes de o app existir, e divergir aí dá um pisca de cor.
        background_color: "#E5EDE9",
        theme_color: "#E5EDE9",
        categories: ["finance", "productivity"],
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          {
            // Com 10% de folga na safe zone: o Android recorta este em círculo,
            // gota ou quadrado conforme o aparelho, e o que fica de fora some.
            src: "/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
          { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
        ],
      },
      // O `apple-touch-icon` não está no manifest — o Safari o lê do `<link>`
      // — então é aqui que ele entra no precache.
      includeAssets: ["apple-touch-icon.png"],
      workbox: {
        /*
         * A casca: HTML, JS, CSS e fontes. Os ícones ficam de fora do glob de
         * propósito — o próprio plugin já precacheia o manifest e tudo o que
         * ele referencia, e listá-los duas vezes só engorda a lista.
         *
         * Só `woff2`: o `woff` vai no bundle como plano B, mas nenhum navegador
         * com service worker precisa dele.
         */
        globPatterns: ["**/*.{js,css,html,woff2}"],
        navigateFallback: "/index.html",
        // Uma navegação para `/api/...` não é navegação de app: deixá-la cair
        // no `index.html` transformaria um erro de API numa página em branco.
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        runtimeCaching: [
          {
            /**
             * Dados nunca saem do cache.
             *
             * Num app de dinheiro, um saldo servido do cache sem aviso é pior
             * do que tela vazia: o número parece atual e não é. O escopo de
             * offline aqui é a casca — o app abre, se explica e diz que está
             * sem conexão, em vez de mostrar uma página em branco.
             */
            urlPattern: ({ url }) => url.pathname.startsWith("/api/"),
            handler: "NetworkOnly",
          },
        ],
      },
      devOptions: {
        // O service worker fica fora do `npm run dev` de propósito: em
        // desenvolvimento ele serve versão velha de módulo e transforma
        // qualquer edição num mistério.
        enabled: false,
      },
    }),
  ],
  test: {
    /*
     * O fuso dos testes e fixo, e nao o da maquina de quem roda.
     *
     * Datas de dia inteiro sao gravadas a meia-noite UTC; formata-las no fuso
     * local as atrasa em um dia a oeste de Greenwich. Se o teste rodasse em
     * UTC, o bug passaria despercebido — que e exatamente como ele chegou ate
     * aqui.
     */
    env: { TZ: "America/Sao_Paulo" },
  },
  server: {
    // Escuta em todas as interfaces para o app abrir tambem pelo IP da rede.
    host: true,
    port: 5173,
    proxy: {
      // Sem reescrita: a API atende em `/api` também em produção, e manter o
      // mesmo caminho nos dois lados evita que o dev e o deploy divirjam.
      "/api": {
        target: "http://127.0.0.1:4000",
        changeOrigin: true,
      },
    },
  },
});
