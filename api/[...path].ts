/**
 * O Express inteiro, como uma função serverless.
 *
 * O nome do arquivo é o que faz `/api/qualquer/coisa` chegar aqui com a URL
 * original preservada — é o catch-all da Vercel. Um `api/index.ts` com rewrite
 * também funcionaria, mas aí a URL que o Express recebe depende de como a
 * plataforma reescreve o caminho, e o roteamento passaria a depender de um
 * detalhe que não está escrito em lugar nenhum.
 *
 * Não há `listen` aqui de propósito: quem escuta é a plataforma. É por isso que
 * `app.ts` sempre foi separado de `server.ts` — o servidor de longa duração usa
 * o segundo, este usa o primeiro, e os dois compartilham a aplicação inteira.
 */
import { app } from "../apps/api/src/app";

export default app;
