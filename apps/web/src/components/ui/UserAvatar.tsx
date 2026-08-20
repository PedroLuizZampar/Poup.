import React, { useEffect, useState } from "react";

export type UserAvatarSize = "xs" | "sm" | "md" | "lg";

export interface UserAvatarProps {
  name: string;
  avatarUrl?: string | null;
  size?: UserAvatarSize;
  className?: string;
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
export function UserAvatar({ name, avatarUrl, size = "md", className = "" }: UserAvatarProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [avatarUrl]);

  const showImage = Boolean(avatarUrl) && !failed;

  return (
    <div
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
