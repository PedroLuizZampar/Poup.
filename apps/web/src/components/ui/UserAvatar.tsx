import React, { useEffect, useState } from "react";

export type UserAvatarSize = "sm" | "md" | "lg";

export interface UserAvatarProps {
  name: string;
  avatarUrl?: string | null;
  size?: UserAvatarSize;
  className?: string;
}

const sizeClasses: Record<UserAvatarSize, string> = {
  sm: "w-8 h-8 text-xs",
  md: "w-10 h-10 text-sm",
  lg: "w-14 h-14 text-lg",
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
      className={`${sizeClasses[size]} rounded-full overflow-hidden bg-primary-soft text-primary font-display font-extrabold flex items-center justify-center shadow-sh1 select-none shrink-0 ${className}`}
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
