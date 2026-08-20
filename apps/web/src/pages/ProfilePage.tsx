import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import type { ItemDTO, AccountDTO, UserDTO, PluggyCredentialsDTO } from "@poup/shared";
import {
  fetchItems,
  fetchAccounts,
  fetchPluggyCredentials,
  syncItem,
  deleteItem,
  clearToken,
} from "../lib/api";
import {
  RefreshIcon,
  TrashIcon,
  EditIcon,
  KeyIcon,
  PlusIcon,
  AlertIcon,
  SunIcon,
  MoonIcon,
  TagIcon,
  ChevronRightIcon,
  DownloadIcon,
  ShareIcon,
  CheckIcon,
} from "../components/icons/Icons";
import { useInstallState } from "../hooks/usePwa";
import { promptInstall } from "../lib/pwa";
import { useTheme } from "../context/ThemeContext";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { InstitutionLogo } from "../components/ui/InstitutionLogo";
import { UserAvatar } from "../components/ui/UserAvatar";
import { EditProfileModal } from "../components/profile/EditProfileModal";
import { ChangePasswordModal } from "../components/profile/ChangePasswordModal";
import { RenameAccountModal } from "../components/profile/RenameAccountModal";
import { EditInstitutionImageModal } from "../components/profile/EditInstitutionImageModal";
import { PluggyCredentialsModal } from "../components/profile/PluggyCredentialsModal";
import { AddConnectionModal } from "../components/profile/AddConnectionModal";
import { useToast } from "../components/ui/Toast";
import { useConfirm } from "../components/ui/ConfirmDialog";
import { formatCurrency, formatDateTime } from "../lib/format";

export function ProfilePage({
  user,
  onUserUpdated,
  onLoggedOut,
}: {
  user: UserDTO;
  onUserUpdated: (user: UserDTO) => void;
  onLoggedOut: () => void;
}) {
  const [items, setItems] = useState<ItemDTO[]>([]);
  const [accounts, setAccounts] = useState<AccountDTO[]>([]);
  const [credentials, setCredentials] = useState<PluggyCredentialsDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncingId, setSyncingId] = useState<string | null>(null);

  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [renamingAccount, setRenamingAccount] = useState<AccountDTO | null>(null);
  const [editingImageItem, setEditingImageItem] = useState<ItemDTO | null>(null);
  const [isCredentialsModalOpen, setIsCredentialsModalOpen] = useState(false);
  const [isAddConnectionOpen, setIsAddConnectionOpen] = useState(false);

  const toast = useToast();
  const confirm = useConfirm();
  const { theme, setTheme } = useTheme();
  const { instalado, podeInstalar, precisaDeInstrucoes } = useInstallState();

  async function loadData() {
    try {
      setLoading(true);
      const [itemsData, accsData, credentialsData] = await Promise.all([
        fetchItems().catch(() => []),
        fetchAccounts().catch(() => []),
        fetchPluggyCredentials().catch(() => null),
      ]);
      setItems(itemsData);
      setAccounts(accsData);
      setCredentials(credentialsData);
    } catch (err) {
      console.error("Erro ao carregar dados de perfil:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  async function handleSyncAll() {
    try {
      setSyncingId("ALL");
      const res = await syncItem();
      toast.success(
        `Sincronização concluída! ${res.accountsSynced} contas e ${res.transactionsSynced} transações atualizadas.`
      );
      await loadData();
    } catch (err: any) {
      toast.error(err.message || "Erro ao sincronizar contas.");
    } finally {
      setSyncingId(null);
    }
  }

  async function handleSyncItem(pluggyItemId: string) {
    try {
      setSyncingId(pluggyItemId);
      const res = await syncItem(pluggyItemId);
      toast.success(
        `Instituição sincronizada! ${res.accountsSynced} contas e ${res.transactionsSynced} transações atualizadas.`
      );
      await loadData();
    } catch (err: any) {
      toast.error(err.message || "Erro ao sincronizar instituição.");
    } finally {
      setSyncingId(null);
    }
  }

  async function handleDeleteItem(item: ItemDTO) {
    const ok = await confirm({
      title: "Desconectar instituição",
      message: `Tem certeza que deseja desconectar ${item.institutionName}? As contas associadas serão desvinculadas.`,
      confirmText: "Desconectar",
      danger: true,
    });
    if (!ok) return;

    try {
      await deleteItem(item.id);
      toast.success("Instituição desconectada com sucesso.");
      await loadData();
    } catch (err: any) {
      toast.error(err.message || "Não foi possível desconectar a instituição.");
    }
  }

  const hasCredentials = Boolean(credentials?.clientId && credentials.hasSecret);

  return (
    <div className="flex flex-col gap-8 anim-fade-up">
      {/* Header */}
      <div>
        <h1 className="text-display-xl font-display font-extrabold text-text-primary">
          Perfil
        </h1>
        <p className="text-xs md:text-sm text-text-secondary mt-0.5">
          Gerencie sua conta e as conexões bancárias do Poup
        </p>
      </div>

      {/* Card do Usuário */}
      <div className="bg-surface rounded-panel p-6 shadow-sh1 border border-border flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <UserAvatar name={user.name} avatarUrl={user.avatarUrl} size="lg" />
          <div className="min-w-0">
            <h3 className="font-display font-bold text-lg text-text-primary truncate">
              {user.name}
            </h3>
            <p className="text-xs text-text-secondary truncate">{user.email}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setIsProfileModalOpen(true)}
            iconLeft={<EditIcon className="w-3.5 h-3.5" />}
          >
            Editar perfil
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setIsPasswordModalOpen(true)}>
            Alterar senha
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              clearToken();
              onLoggedOut();
            }}
            className="hover:text-error"
          >
            Encerrar sessão
          </Button>
        </div>
      </div>

      {/* Preferências.
          As duas entradas aqui existem porque o mobile não tem onde mais
          alcançá-las: o alternador de tema morava só no header, que encolhe, e
          Categorias saiu da barra inferior para caber em cinco abas. */}
      <div className="bg-surface rounded-panel p-6 shadow-sh1 border border-border flex flex-col gap-5">
        <div>
          <h2 className="font-display font-bold text-base md:text-lg text-text-primary">
            Preferências
          </h2>
          <p className="text-xs text-text-secondary mt-0.5">
            Aparência do app e organização das suas categorias
          </p>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-semibold text-sm text-text-primary">Aparência</h3>
            <p className="text-xs text-text-secondary mt-0.5">
              Sem escolha aqui, o app segue o tema do seu sistema.
            </p>
          </div>

          <div
            role="radiogroup"
            aria-label="Tema do aplicativo"
            className="flex items-center gap-1 p-1 rounded-ctl bg-surface-alt border border-border self-start sm:self-auto shrink-0"
          >
            {(
              [
                { value: "light", label: "Claro", Icon: SunIcon },
                { value: "dark", label: "Escuro", Icon: MoonIcon },
              ] as const
            ).map(({ value, label, Icon }) => {
              const isActive = theme === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  onClick={() => setTheme(value)}
                  className={`h-ctl-sm min-h-ctl-sm px-4 rounded-ctl flex items-center gap-2 text-xs font-semibold transition-colors focus-ring cursor-pointer ${
                    isActive
                      ? "bg-surface text-text-primary shadow-sh1"
                      : "text-text-secondary hover:text-text-primary"
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Instalar na tela de início. A seção só aparece quando há o que
            oferecer: com o app já instalado, ou num navegador que não instala,
            ela seria promessa sem botão. */}
        {(podeInstalar || precisaDeInstrucoes || instalado) && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1 border-t border-border/60">
            <div className="min-w-0">
              <h3 className="font-semibold text-sm text-text-primary flex items-center gap-2">
                Instalar o Poup
                {instalado && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary">
                    <CheckIcon className="w-3.5 h-3.5" aria-hidden="true" /> instalado
                  </span>
                )}
              </h3>
              <p className="text-xs text-text-secondary mt-0.5 leading-relaxed">
                {instalado
                  ? "O app já está na sua tela de início e abre sem a barra do navegador."
                  : precisaDeInstrucoes
                  ? "No iPhone e no iPad a instalação é manual: toque em Compartilhar e depois em “Adicionar à Tela de Início”."
                  : "Coloque um ícone na tela de início e abra o Poup como um app, sem a barra do navegador."}
              </p>
            </div>

            {podeInstalar && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => void promptInstall()}
                iconLeft={<DownloadIcon className="w-4 h-4" />}
                className="self-start sm:self-auto shrink-0"
              >
                Instalar o Poup
              </Button>
            )}

            {precisaDeInstrucoes && (
              <span
                aria-hidden="true"
                className="self-start sm:self-auto shrink-0 w-10 h-10 rounded-tile bg-surface-alt border border-border text-text-secondary flex items-center justify-center"
              >
                <ShareIcon className="w-5 h-5" />
              </span>
            )}
          </div>
        )}

        <Link
          to="/categorias"
          className="flex items-center gap-3 p-3 -mx-1 rounded-card border border-border bg-surface-alt/50 hover:bg-surface-alt transition-colors focus-ring min-h-ctl"
        >
          <span className="w-10 h-10 rounded-tile bg-primary-soft text-primary flex items-center justify-center shrink-0">
            <TagIcon className="w-5 h-5" aria-hidden="true" />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block font-semibold text-sm text-text-primary">Categorias</span>
            <span className="block text-xs text-text-secondary">
              Criar, renomear e excluir categorias de gasto
            </span>
          </span>
          <ChevronRightIcon className="w-4 h-4 text-text-secondary shrink-0" aria-hidden="true" />
        </Link>
      </div>

      {/* Credenciais da Pluggy. Ficam acima das conexões porque são o que
          habilita todas elas: sem credencial válida, nada abaixo funciona. */}
      <div className="bg-surface rounded-panel p-6 shadow-sh1 border border-border flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-4 min-w-0">
          <div
            className={`w-10 h-10 rounded-tile shrink-0 flex items-center justify-center ${
              hasCredentials ? "bg-primary-soft text-primary" : "bg-warning-soft text-warning"
            }`}
          >
            {hasCredentials ? <KeyIcon className="w-5 h-5" /> : <AlertIcon className="w-5 h-5" />}
          </div>

          <div className="min-w-0">
            <h3 className="font-display font-bold text-base text-text-primary">
              Credenciais da Pluggy
            </h3>

            {hasCredentials ? (
              <div className="mt-1 flex flex-col gap-0.5">
                <span className="text-xs text-text-secondary truncate">
                  Client ID{" "}
                  <span className="font-medium text-text-primary tnum">{credentials!.clientId}</span>
                </span>
                <span className="text-xs text-text-secondary">
                  Client Secret{" "}
                  <span className="font-medium text-text-primary tracking-widest">••••••••••</span>
                </span>
              </div>
            ) : (
              <p className="text-xs text-text-secondary mt-1 leading-relaxed max-w-prose">
                Nenhuma credencial cadastrada. Sem ela o app não consegue sincronizar nem adicionar
                conexões bancárias.
              </p>
            )}
          </div>
        </div>

        <Button
          variant={hasCredentials ? "secondary" : "primary"}
          size="sm"
          onClick={() => setIsCredentialsModalOpen(true)}
          className="self-start sm:self-auto shrink-0"
        >
          {hasCredentials ? "Alterar credenciais" : "Cadastrar credenciais"}
        </Button>
      </div>

      {/* Seção Contas Conectadas */}
      <div className="bg-surface rounded-panel p-6 md:p-8 shadow-sh2 border border-border flex flex-col gap-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="font-display font-bold text-base md:text-lg text-text-primary">
              Contas bancárias conectadas
            </h2>
            <p className="text-xs text-text-secondary mt-0.5">
              Conexões de leitura automáticas
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setIsAddConnectionOpen(true)}
              iconLeft={<PlusIcon className="w-3.5 h-3.5" />}
            >
              Adicionar conexão
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleSyncAll}
              loading={syncingId === "ALL"}
              disabled={items.length === 0}
              iconLeft={<RefreshIcon className="w-3.5 h-3.5" />}
            >
              Sincronizar todas as contas
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="py-8 text-center text-xs text-text-secondary">
            Carregando conexões bancárias...
          </div>
        ) : items.length === 0 ? (
          <div className="py-8 flex flex-col items-center gap-3 text-center">
            <p className="text-xs text-text-secondary max-w-sm leading-relaxed">
              Nenhuma instituição conectada. Cole o id do item da Pluggy para importar as contas e o
              histórico de transações do banco.
            </p>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setIsAddConnectionOpen(true)}
              iconLeft={<PlusIcon className="w-3.5 h-3.5" />}
            >
              Adicionar conexão
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {items.map((item) => {
              const itemAccounts = accounts.filter((a) => a.itemId === item.id);
              // O estado saudável não ganha selo: "Sincronizado" repetia o que a
              // data de última sincronização logo abaixo já diz. Só problema —
              // que exige ação do usuário — continua sinalizado.
              const hasIssue = item.status !== "UPDATED";
              const statusVariant = item.status === "LOGIN_ERROR" ? "danger" : "warning";
              const statusLabel =
                item.status === "LOGIN_ERROR" ? "Reconexão necessária" : "Pendente";

              return (
                <div
                  key={item.id}
                  className="p-5 rounded-card bg-surface-alt/50 border border-border flex flex-col gap-4"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      {/* O logo é o próprio alvo de edição: clicar nele abre a
                          troca de imagem, sem um botão extra competindo por
                          espaço na linha. */}
                      <button
                        type="button"
                        onClick={() => setEditingImageItem(item)}
                        title={`Alterar imagem de ${item.institutionName}`}
                        aria-label={`Alterar imagem de ${item.institutionName}`}
                        className="relative group rounded-tile focus-ring cursor-pointer shrink-0"
                      >
                        <InstitutionLogo
                          name={item.institutionName}
                          imageUrl={item.institutionImageUrl}
                          customImageUrl={item.customImageUrl}
                          size="md"
                          className="shadow-sh1"
                        />
                        <span className="coarse:hidden absolute inset-0 rounded-tile bg-black/55 text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <EditIcon className="w-3.5 h-3.5" />
                        </span>
                        {/* No toque o mesmo recurso vira um selo permanente:
                            sem hover, a cortina acima nunca apareceria. */}
                        <span className="hidden coarse:flex absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-primary text-white border-2 border-surface items-center justify-center">
                          <EditIcon className="w-2.5 h-2.5" />
                        </span>
                      </button>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="font-bold text-sm md:text-base text-text-primary truncate">
                            {item.institutionName}
                          </h4>
                          {hasIssue && (
                            <Badge variant={statusVariant}>{statusLabel}</Badge>
                          )}
                        </div>
                        <span className="text-[11px] text-text-secondary block mt-0.5 tnum">
                          Última sincronização:{" "}
                          {item.lastSyncedAt ? formatDateTime(item.lastSyncedAt) : "Nunca"}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleSyncItem(item.pluggyItemId)}
                        loading={syncingId === item.pluggyItemId}
                        iconLeft={<RefreshIcon className="w-3.5 h-3.5" />}
                      >
                        Sincronizar
                      </Button>
                      {/* O ícone herda a cor do botão (`currentColor`) em vez de
                          ter hover próprio: assim o botão inteiro é um único
                          alvo de hover, e não dois que acendem separados. */}
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleDeleteItem(item)}
                        className="hover:!bg-error-soft hover:!text-error hover:!border-error/40"
                        title="Desconectar instituição"
                        aria-label="Desconectar instituição"
                      >
                        <TrashIcon className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>

                  {itemAccounts.length > 0 && (
                    <div className="pt-3 border-t border-border/60 flex flex-col gap-2">
                      <span className="text-overline uppercase tracking-wider text-text-secondary">
                        Contas vinculadas ({itemAccounts.length}):
                      </span>
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                        {itemAccounts.map((acc) => (
                          <div
                            key={acc.id}
                            className="p-3 rounded-tile bg-surface border border-border flex flex-col gap-1 shadow-sh1 group"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <span className="font-semibold text-xs text-text-primary truncate">
                                {acc.name}
                              </span>
                              <button
                                type="button"
                                onClick={() => setRenamingAccount(acc)}
                                title="Renomear conta"
                                aria-label={`Renomear a conta ${acc.name}`}
                                className="tap-target text-text-disabled hover:text-primary transition-colors rounded-ctl focus-ring cursor-pointer shrink-0"
                              >
                                <EditIcon className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <span className="font-display font-bold text-sm text-primary tnum">
                              {formatCurrency(acc.balance)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <EditProfileModal
        isOpen={isProfileModalOpen}
        user={user}
        onClose={() => setIsProfileModalOpen(false)}
        onSaved={onUserUpdated}
      />

      <ChangePasswordModal
        isOpen={isPasswordModalOpen}
        onClose={() => setIsPasswordModalOpen(false)}
      />

      <RenameAccountModal
        account={renamingAccount}
        onClose={() => setRenamingAccount(null)}
        onSaved={loadData}
      />

      <EditInstitutionImageModal
        item={editingImageItem}
        onClose={() => setEditingImageItem(null)}
        onSaved={loadData}
      />

      <PluggyCredentialsModal
        isOpen={isCredentialsModalOpen}
        currentClientId={credentials?.clientId ?? null}
        onClose={() => setIsCredentialsModalOpen(false)}
        onSaved={setCredentials}
      />

      <AddConnectionModal
        isOpen={isAddConnectionOpen}
        hasCredentials={hasCredentials}
        onClose={() => setIsAddConnectionOpen(false)}
        onAdded={loadData}
      />
    </div>
  );
}
