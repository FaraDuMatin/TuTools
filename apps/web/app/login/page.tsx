"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn, signUp, type Language } from "@/lib/auth-client";
import { t } from "@/lib/i18n";

export default function LoginPage() {
  const router = useRouter();
  const [language, setLanguage] = useState<Language>("FR");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const copy = t(language);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);

    // `role` is intentionally never sent. The server rejects it as input, so a
    // crafted request cannot self-assign CEO.
    const result =
      mode === "signup"
        ? await signUp.email({ name, email, password, language })
        : await signIn.email({ email, password });

    setPending(false);

    if (result.error) {
      setError(result.error.message ?? copy.genericError);
      return;
    }
    router.push("/dashboard");
  }

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-baseline justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">Tutools</h1>
          <button
            type="button"
            onClick={() => setLanguage(language === "FR" ? "EN" : "FR")}
            className="text-sm text-zinc-500 underline underline-offset-4 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            {language === "FR" ? "English" : "Français"}
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {mode === "signup" && (
            <Field
              label={copy.name}
              value={name}
              onChange={setName}
              type="text"
              autoComplete="name"
              required
            />
          )}

          <Field
            label={copy.email}
            value={email}
            onChange={setEmail}
            type="email"
            autoComplete="email"
            required
          />

          <Field
            label={copy.password}
            value={password}
            onChange={setPassword}
            type="password"
            autoComplete={
              mode === "signup" ? "new-password" : "current-password"
            }
            minLength={8}
            hint={mode === "signup" ? copy.passwordHint : undefined}
            required
          />

          {error && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="mt-2 rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {pending
              ? copy.loading
              : mode === "signup"
                ? copy.signUp
                : copy.signIn}
          </button>
        </form>

        <button
          type="button"
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setError(null);
          }}
          className="mt-6 text-sm text-zinc-500 underline underline-offset-4 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          {mode === "signin" ? copy.noAccount : copy.haveAccount}
        </button>
      </div>
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
  hint,
  ...props
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <input
        {...props}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:focus:border-zinc-100"
      />
      {hint && <span className="text-xs text-zinc-500">{hint}</span>}
    </label>
  );
}
