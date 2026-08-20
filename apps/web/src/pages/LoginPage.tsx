import React, { FormEvent, useState } from "react";
import { login, setToken } from "../lib/api";
import { Logo } from "../components/icons/Logo";
import { Button } from "../components/ui/Button";
import { Field } from "../components/ui/Field";
import { Input } from "../components/ui/Input";

export function LoginPage({
  onLoggedIn,
  onGoToSignup,
}: {
  onLoggedIn: () => void;
  onGoToSignup: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await login({ email: email.trim(), password });
      setToken(result.token);
      onLoggedIn();
    } catch (err: any) {
      setError(err instanceof Error ? err.message : "Credenciais inválidas. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-dvh flex items-center justify-center bg-bg p-4 anim-fade-in">
      <div className="w-full max-w-md bg-surface rounded-panel shadow-sh3 border border-border p-6 sm:p-8 md:p-10 flex flex-col gap-6">
        {/* Header com Logo */}
        <div className="flex flex-col items-center text-center gap-2">
          <div className="w-12 h-12 rounded-tile bg-primary-soft flex items-center justify-center mb-1 shadow-sh1">
            <Logo className="w-7 h-7 text-primary" />
          </div>
          <h1 className="font-display font-extrabold text-2xl md:text-3xl tracking-tight text-text-primary">
            Poup<span className="text-primary">.</span>
          </h1>
          <p className="text-xs text-text-secondary">
            Entre na sua conta para acessar seu painel financeiro
          </p>
        </div>

        {/* Formulário de Login */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field id="login-email" label="E-mail" required>
            <Input
              id="login-email"
              type="email"
              required
              placeholder="seu@email.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (error) setError(null);
              }}
              autoFocus
            />
          </Field>

          <Field id="login-password" label="Senha" required>
            <Input
              id="login-password"
              type="password"
              required
              placeholder="Sua senha"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (error) setError(null);
              }}
            />
          </Field>

          {error && (
            <div
              role="alert"
              className="p-3.5 rounded-tile bg-error-soft border border-error/20 text-error text-xs font-medium leading-relaxed anim-fade-in"
            >
              {error}
            </div>
          )}

          <Button
            type="submit"
            variant="primary"
            size="lg"
            loading={loading}
            className="w-full mt-2"
          >
            Entrar
          </Button>

          <p className="text-xs text-text-secondary text-center">
            Ainda não tem conta?{" "}
            <button
              type="button"
              onClick={onGoToSignup}
              className="font-semibold text-primary hover:underline focus-ring rounded-chip"
            >
              Criar conta
            </button>
          </p>
        </form>
      </div>
    </div>
  );
}

