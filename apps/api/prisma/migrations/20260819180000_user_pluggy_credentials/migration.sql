-- Credenciais da aplicação Pluggy passam a viver no usuário, não no ambiente.
-- O secret é guardado cifrado (AES-256-GCM); ver src/lib/crypto.ts.
ALTER TABLE "User" ADD COLUMN "pluggyClientId" TEXT;
ALTER TABLE "User" ADD COLUMN "pluggyClientSecret" TEXT;
