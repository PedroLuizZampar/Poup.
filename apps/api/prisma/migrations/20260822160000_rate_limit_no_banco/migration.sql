-- Contagem de tentativas por IP, para as rotas sem autenticação.
--
-- Ela morava num Map de processo, sob a premissa escrita no próprio
-- `rateLimit.ts`: "a API é um processo só, por instalação". Hospedada como
-- função serverless essa premissa deixa de valer — cada instância teria o seu
-- mapa, as tentativas de quem varre senhas se espalhariam entre elas, e o
-- limite de 10 por 15 minutos viraria 10 por instância. Aqui há um contador só.
CREATE TABLE "RateLimitHit" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "resetAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitHit_pkey" PRIMARY KEY ("key")
);

-- Para a limpeza das janelas vencidas não virar varredura da tabela inteira.
CREATE INDEX "RateLimitHit_resetAt_idx" ON "RateLimitHit"("resetAt");
