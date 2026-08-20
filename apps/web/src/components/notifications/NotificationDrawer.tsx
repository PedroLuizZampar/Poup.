import React, { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import type { NotificationDTO } from "@poup/shared";
import {
  fetchNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from "../../lib/api";
import { CloseIcon, CheckIcon } from "../icons/Icons";
import { formatDateTime } from "../../lib/format";
import { useMediaQuery } from "../../hooks/useMediaQuery";

interface NotificationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onUpdateUnread: (count: number) => void;
}

export function NotificationDrawer({
  isOpen,
  onClose,
  onUpdateUnread,
}: NotificationDrawerProps) {
  const [notifications, setNotifications] = useState<NotificationDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  /**
   * O painel é ancorado no sino — só que o sino não é o último item do header:
   * o avatar vem depois. Em 360px a borda esquerda do popover caía em ≈ -40px.
   * Abaixo de `sm` ele deixa de ser popover e vira folha de rodapé, que não
   * depende de onde o gatilho está.
   */
  const isSheet = useMediaQuery("(max-width: 639px)");

  async function loadData() {
    try {
      setLoading(true);
      const data = await fetchNotifications();
      setNotifications(data.notifications);
      onUpdateUnread(data.unreadCount);
    } catch (err) {
      console.error("Erro ao carregar notificações:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        onClose();
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  async function handleMarkRead(id: string) {
    try {
      await markNotificationRead(id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n))
      );
      onUpdateUnread(notifications.filter((n) => !n.read && n.id !== id).length);
    } catch (err) {
      console.error("Erro ao marcar como lida:", err);
    }
  }

  async function handleMarkAllRead() {
    try {
      await markAllNotificationsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      onUpdateUnread(0);
    } catch (err) {
      console.error("Erro ao marcar todas como lidas:", err);
    }
  }

  if (!isOpen) return null;

  const panel = (
    <div
      ref={containerRef}
      className={
        isSheet
          ? "w-full max-h-[80dvh] bg-surface rounded-t-panel shadow-sh3 border border-b-0 border-border flex flex-col overflow-hidden anim-fade-up pb-[env(safe-area-inset-bottom)]"
          : "absolute top-12 right-0 w-96 max-h-[480px] bg-surface rounded-panel shadow-sh3 border border-border flex flex-col z-50 overflow-hidden anim-scale-in"
      }
    >
      {isSheet && (
        <div
          aria-hidden="true"
          className="mx-auto w-10 h-1 rounded-full bg-border-strong shrink-0 mt-3"
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-surface">
        <div className="flex items-center gap-2">
          <h3 className="font-display font-bold text-sm text-text-primary">
            Notificações
          </h3>
          {notifications.some((n) => !n.read) && (
            <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-primary text-white tnum">
              {notifications.filter((n) => !n.read).length}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {notifications.some((n) => !n.read) && (
            <button
              type="button"
              onClick={handleMarkAllRead}
              className="tap-target text-[11px] font-semibold text-primary hover:underline transition-all cursor-pointer focus-ring px-1.5 py-0.5 rounded-ctl"
            >
              Marcar lidas
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar notificações"
            className="tap-target w-7 h-7 rounded-ctl bg-surface-alt flex items-center justify-center text-text-secondary hover:text-text-primary transition-colors cursor-pointer focus-ring"
          >
            <CloseIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Lista */}
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
        {loading && notifications.length === 0 ? (
          <div className="py-8 text-center text-xs text-text-secondary">
            Carregando notificações...
          </div>
        ) : notifications.length === 0 ? (
          <div className="py-8 text-center text-xs text-text-secondary">
            Nenhuma notificação recente.
          </div>
        ) : (
          notifications.map((n) => {
            const isError = n.severity === "ERROR";
            const isWarning = n.severity === "WARNING";

            return (
              <div
                key={n.id}
                className={`p-3 rounded-card border transition-all flex flex-col gap-1.5 ${
                  n.read
                    ? "bg-surface border-border/60 opacity-60"
                    : isError
                    ? "bg-error-soft border-error/20"
                    : isWarning
                    ? "bg-warning-soft border-warning/20"
                    : "bg-surface-alt border-border"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        isError
                          ? "bg-error"
                          : isWarning
                          ? "bg-warning"
                          : "bg-primary"
                      }`}
                    />
                    <span className="font-display font-bold text-xs text-text-primary">
                      {n.title}
                    </span>
                  </div>

                  {!n.read && (
                    <button
                      type="button"
                      onClick={() => handleMarkRead(n.id)}
                      title="Marcar como lida"
                      aria-label="Marcar como lida"
                      className="tap-target text-text-disabled hover:text-primary transition-colors p-1 rounded-ctl focus-ring cursor-pointer"
                    >
                      <CheckIcon className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <p className="text-caption text-text-secondary leading-relaxed pl-4">
                  {n.body}
                </p>

                <span className="text-[10px] text-text-disabled pl-4 tnum">
                  {formatDateTime(n.createdAt)}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );

  if (!isSheet) return panel;

  return createPortal(
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm anim-fade-in"
    >
      {panel}
    </div>,
    document.body
  );
}

