import React, { useEffect, useState } from "react";
import { BankIcon } from "../icons/Icons";
import { resolveInstitutionLogo } from "../../lib/institutions";

export type InstitutionLogoSize = "sm" | "md" | "lg";

export interface InstitutionLogoProps {
  name?: string | null;
  imageUrl?: string | null;
  /** Imagem enviada pelo usuário; tem precedência sobre `imageUrl`. */
  customImageUrl?: string | null;
  size?: InstitutionLogoSize;
  className?: string;
}

const sizeClasses: Record<InstitutionLogoSize, string> = {
  sm: "w-8 h-8 rounded-tile",
  md: "w-10 h-10 rounded-tile",
  lg: "w-12 h-12 rounded-card",
};

const iconClasses: Record<InstitutionLogoSize, string> = {
  sm: "w-4 h-4",
  md: "w-5 h-5",
  lg: "w-6 h-6",
};

/**
 * Avatar da instituição financeira. Cai para o ícone genérico de banco quando
 * não há logo local nem imagem vinda da API, e também quando a imagem falha ao
 * carregar (CDN fora do ar, máquina offline) — o avatar nunca fica vazio.
 *
 * A imagem preenche o tile inteiro (`object-cover`, sem respiro e sem borda):
 * as logos usadas aqui já vêm com a própria margem embutida, então acrescentar
 * padding só desenhava um anel branco em volta delas. O corte pelo lado menor
 * mantém a proporção — o preço é aparar as pontas de uma arte não-quadrada, e
 * quadrada é justamente o formato que os conectores publicam.
 *
 * O fundo branco atrás da imagem cobre o caso da logo com transparência; a cor
 * da marca vinda do conector não serve, porque é a cor *do logo* e faz ele
 * desaparecer dentro dela (o conector sandbox da Pluggy, vermelho sobre
 * vermelho, era exatamente esse caso).
 */
export function InstitutionLogo({
  name,
  imageUrl,
  customImageUrl,
  size = "md",
  className = "",
}: InstitutionLogoProps) {
  const [failed, setFailed] = useState(false);
  const src = resolveInstitutionLogo(name, imageUrl, customImageUrl);

  // Sem este reset, trocar a imagem de um banco cujo logo anterior falhou
  // deixaria o avatar preso no ícone genérico até recarregar o app.
  useEffect(() => {
    setFailed(false);
  }, [src]);

  const showImage = Boolean(src) && !failed;

  return (
    <div
      className={`${sizeClasses[size]} shrink-0 overflow-hidden ${
        showImage
          ? "bg-white"
          : "bg-surface-alt text-text-secondary border border-border flex items-center justify-center"
      } ${className}`}
      aria-hidden="true"
    >
      {showImage ? (
        <img
          src={src!}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="block w-full h-full object-cover"
        />
      ) : (
        <BankIcon className={iconClasses[size]} />
      )}
    </div>
  );
}
