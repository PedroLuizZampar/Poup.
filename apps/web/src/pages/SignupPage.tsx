import React, { FormEvent, useState } from "react";
import { ApiError, register, setToken } from "../lib/api";
import { Logo } from "../components/icons/Logo";
import { Button } from "../components/ui/Button";
import { Field } from "../components/ui/Field";
import { Input } from "../components/ui/Input";
import { SecretInput } from "../components/ui/SecretInput";

const MIN_PASSWORD_LENGTH = 8;

type FieldName =
  | "name"
  | "email"
  | "password"
  | "confirmPassword"
  | "pluggyClientId"
  | "pluggyClientSecret";

type FieldErrors = Partial<Record<FieldName, string>>;

/**
 * Cadastro de conta.
 *
 * O formulário reúne duas coisas de naturezas diferentes — quem é o usuário e
 * com qual aplicação da Pluggy o app vai ler os bancos dele — e por isso é
 * dividido em dois blocos declarados. Seis campos seguidos, sem essa separação,
 * fariam o client id parecer mais um dado pessoal.
 */
export function SignupPage({
  onSignedUp,
  onGoToLogin,
}: {
  onSignedUp: () => void;
  onGoToLogin: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");

  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function clearError(field: FieldName) {
    setFormError(null);
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  function validate(): FieldErrors {
    const next: FieldErrors = {};
    if (!name.trim()) next.name = "Informe seu nome.";
    if (!email.trim()) next.email = "Informe seu e-mail.";
    if (password.length < MIN_PASSWORD_LENGTH) {
      next.password = `A senha precisa ter ao menos ${MIN_PASSWORD_LENGTH} caracteres.`;
    }
    if (confirmPassword !== password) next.confirmPassword = "As senhas não conferem.";
    if (!clientId.trim()) next.pluggyClientId = "Informe o Client ID.";
    if (!clientSecret.trim()) next.pluggyClientSecret = "Informe o Client Secret.";
    return next;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    const found = validate();
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }

    setErrors({});
    setFormError(null);
    setLoading(true);

    try {
      const result = await register({
        name: name.trim(),
        email: email.trim(),
        password,
        confirmPassword,
        pluggyClientId: clientId.trim(),
        pluggyClientSecret: clientSecret.trim(),
      });
      setToken(result.token);
      onSignedUp();
    } catch (err) {
      // A API diz qual campo recusou (email em uso, credencial rejeitada pela
      // Pluggy); acender o erro nele é o que torna o problema corrigível.
      if (err instanceof ApiError && err.field) {
        setErrors({ [err.field as FieldName]: err.message });
      } else {
        setFormError(err instanceof Error ? err.message : "Não foi possível criar a conta.");
      }
    } finally {
      setLoading(false);
    }
  }

  const confirmMismatch = confirmPassword.length > 0 && confirmPassword !== password;

  return (
    <div className="min-h-dvh overflow-y-auto flex items-center justify-center bg-bg p-4 py-10 anim-fade-in">
      <div className="w-full max-w-lg bg-surface rounded-panel shadow-sh3 border border-border p-6 sm:p-8 md:p-10 flex flex-col gap-7">
        <div className="flex flex-col items-center text-center gap-2">
          <div className="w-12 h-12 rounded-tile bg-primary-soft flex items-center justify-center mb-1 shadow-sh1">
            <Logo className="w-7 h-7 text-primary" />
          </div>
          <h1 className="font-display font-extrabold text-2xl md:text-3xl tracking-tight text-text-primary">
            Criar sua conta
          </h1>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-7">
          <section className="flex flex-col gap-4">
            <h2 className="font-display font-bold text-sm text-text-primary">Sua conta</h2>

            <Field id="signup-name" label="Nome" required error={errors.name}>
              <Input
                id="signup-name"
                required
                placeholder="Como devemos te chamar"
                autoComplete="name"
                hasError={Boolean(errors.name)}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  clearError("name");
                }}
                autoFocus
              />
            </Field>

            <Field id="signup-email" label="E-mail" required error={errors.email}>
              <Input
                id="signup-email"
                type="email"
                required
                placeholder="seu@email.com"
                autoComplete="email"
                hasError={Boolean(errors.email)}
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  clearError("email");
                }}
              />
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field
                id="signup-password"
                label="Senha"
                required
                hint={`mín. ${MIN_PASSWORD_LENGTH} caracteres`}
                error={errors.password}
              >
                <SecretInput
                  id="signup-password"
                  required
                  autoComplete="new-password"
                  hasError={Boolean(errors.password)}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    clearError("password");
                  }}
                />
              </Field>

              <Field
                id="signup-confirm"
                label="Confirmar senha"
                required
                error={errors.confirmPassword ?? (confirmMismatch ? "As senhas não conferem." : undefined)}
              >
                <SecretInput
                  id="signup-confirm"
                  required
                  autoComplete="new-password"
                  hasError={Boolean(errors.confirmPassword) || confirmMismatch}
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    clearError("confirmPassword");
                  }}
                />
              </Field>
            </div>
          </section>

          <section className="flex flex-col gap-4 pt-1 border-t border-border">
            <div className="pt-5">
              <h2 className="font-display font-bold text-sm text-text-primary">Integração Pluggy</h2>
              <p className="text-xs text-text-secondary mt-1 leading-relaxed">
                O Poup lê seus bancos pela sua própria aplicação na Pluggy. Copie as duas chaves em
                Applications, no painel da Pluggy — elas são conferidas com a Pluggy antes da conta
                ser criada.
              </p>
            </div>

            <Field id="signup-client-id" label="Client ID" required error={errors.pluggyClientId}>
              <Input
                id="signup-client-id"
                required
                placeholder="00000000-0000-0000-0000-000000000000"
                autoComplete="off"
                spellCheck={false}
                hasError={Boolean(errors.pluggyClientId)}
                value={clientId}
                onChange={(e) => {
                  setClientId(e.target.value);
                  clearError("pluggyClientId");
                }}
              />
            </Field>

            <Field
              id="signup-client-secret"
              label="Client Secret"
              required
              error={errors.pluggyClientSecret}
            >
              <SecretInput
                id="signup-client-secret"
                required
                placeholder="Cole o secret da sua aplicação"
                autoComplete="off"
                spellCheck={false}
                hasError={Boolean(errors.pluggyClientSecret)}
                value={clientSecret}
                onChange={(e) => {
                  setClientSecret(e.target.value);
                  clearError("pluggyClientSecret");
                }}
              />
            </Field>
          </section>

          {formError && (
            <div
              role="alert"
              className="p-3.5 rounded-tile bg-error-soft border border-error/20 text-error text-xs font-medium leading-relaxed anim-fade-in"
            >
              {formError}
            </div>
          )}

          <div className="flex flex-col gap-3">
            <Button type="submit" variant="primary" size="lg" loading={loading} className="w-full">
              Criar conta
            </Button>

            <p className="text-xs text-text-secondary text-center">
              Já tem uma conta?{" "}
              <button
                type="button"
                onClick={onGoToLogin}
                className="font-semibold text-primary hover:underline focus-ring rounded-chip"
              >
                Entrar
              </button>
            </p>
          </div>
        </form>
      </div>
    </div>
  );
}
