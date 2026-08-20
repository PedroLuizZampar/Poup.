-- AlterTable: marca da instituição (logo e cor) capturada do conector Pluggy
ALTER TABLE "Item" ADD COLUMN "institutionImageUrl" TEXT;
ALTER TABLE "Item" ADD COLUMN "institutionColor" TEXT;
