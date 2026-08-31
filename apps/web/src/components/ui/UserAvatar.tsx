import React, { useEffect, useState } from "react";

export type UserAvatarSize = "xs" | "sm" | "md" | "lg";

export interface UserAvatarProps {
  name: string;
  avatarUrl?: string | null;
  size?: UserAvatarSize;
  className?: string;
  /**
   * Nome anunciado por leitor de tela. Fica de fora por padrão porque a
   * maioria dos usos põe o nome como texto visível ao lado — repetir aí
   * duplicaria a leitura. Só entra onde o avatar é o único indício de quem é
   * o dono, como a linha da transação: sem isto, um usuário de leitor de tela
   * não tem como saber de quem é aquela linha.
   */
  "aria-label"?: string;
}

const sizeClasses: Record<UserAvatarSize, string> = {
  /** Do tamanho de um ícone de 24px — é assim que ele entra na barra inferior.
   *  Sem sombra: ali ele convive com ícones de traço, e elevação destoaria. */
  xs: "w-6 h-6 text-[9px]",
  sm: "w-8 h-8 text-xs shadow-sh1",
  md: "w-10 h-10 text-sm shadow-sh1",
  lg: "w-14 h-14 text-lg shadow-sh1",
};

export function getInitials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/**
 * Foto de perfil do usuário, com as iniciais como fallback — usada quando não há
 * foto e também quando a imagem salva não carrega.
 */
export function UserAvatar({
  name,
  avatarUrl,
  size = "md",
  className = "",
  "aria-label": ariaLabel,
}: UserAvatarProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [avatarUrl]);

  const showImage = Boolean(avatarUrl) && !failed;

  return (
    <div
      role={ariaLabel ? "img" : undefined}
      aria-label={ariaLabel}
      className={`${sizeClasses[size]} rounded-full overflow-hidden bg-primary-soft text-primary font-display font-extrabold flex items-center justify-center select-none shrink-0 ${className}`}
    >
      {showImage ? (
        <img
          src={avatarUrl!}
          alt=""
          onError={() => setFailed(true)}
          className="w-full h-full object-cover"
        />
      ) : (
        getInitials(name)
      )}
    </div>
  );
}
