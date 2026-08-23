/**
 * O Express inteiro, como uma função serverless.
 *
 * Uma função só, num caminho fixo, e um `rewrite` no `vercel.json` mandando
 * `/api/*` inteiro para cá. Este arquivo já se chamou `[...path].ts`, contando
 * com o catch-all da Vercel para receber os caminhos profundos — mas a
 * plataforma tratava a rota como um segmento único: `/api/health` chegava aqui
 * e `/api/auth/login` voltava NOT_FOUND antes de tocar no Express. O rewrite
 * explícito não depende de o nome do arquivo ser interpretado como catch-all.
 *
 * A URL original sobrevive ao rewrite — o Express vê `/api/auth/login`, e não o
 * destino. Isso está verificado em produção: `/health`, que é reescrito para
 * `/api`, é atendido pelo `app.get("/health")` e não pela rota de dentro do
 * `apiRouter`, que responderia com os headers de CORS.
 *
 * Não há `listen` aqui de propósito: quem escuta é a plataforma. É por isso que
 * `app.ts` sempre foi separado de `server.ts` — o servidor de longa duração usa
 * o segundo, este usa o primeiro, e os dois compartilham a aplicação inteira.
 */
import { app } from "../apps/api/src/app";

export default app;
