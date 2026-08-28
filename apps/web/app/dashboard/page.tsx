"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut, useSession, type Language } from "@/lib/auth-client";
import { t, type Dictionary } from "@/lib/i18n";

type Me = {
  id: string;
  name: string;
  email: string;
  role: string;
  language: Language;
};

type Participant = {
  userId: string;
  role: "TUTOR" | "STUDENT" | "OBSERVER";
  firstJoinedAt: string | null;
  totalSeconds: number | null;
  user: { id: string; name: string; email: string };
};

type TutoringSession = {
  id: string;
  title: string | null;
  status: "SCHEDULED" | "LIVE" | "ENDED" | "CANCELLED";
  visibility: "PRIVATE" | "PUBLIC";
  scheduledFor: string | null;
  startedAt: string | null;
  durationSeconds: number | null;
  participants: Participant[];
};

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export default function DashboardPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const [me, setMe] = useState<Me | null>(null);
  const [sessions, setSessions] = useState<TutoringSession[]>([]);

  const copy = t(me?.language ?? "FR");

  const loadSessions = useCallback(async () => {
    try {
      const response = await fetch(`${API}/api/sessions`, {
        credentials: "include",
      });
      if (response.ok) setSessions((await response.json()) as TutoringSession[]);
    } catch {
      // A failed list is not worth blocking the page for; the session data
      // itself lives on the server and will be there on the next load.
    }
  }, []);

  // The cookie alone is not treated as truth: on every load we ask Nest who we
  // are. This is what makes a refresh or a new device restore correctly.
  useEffect(() => {
    if (isPending) return;
    if (!session) {
      router.replace("/login");
      return;
    }
    fetch(`${API}/api/me`, { credentials: "include" })
      .then((response) => (response.ok ? response.json() : null))
      .then(setMe)
      .catch(() => setMe(null));
    void loadSessions();
  }, [session, isPending, router, loadSessions]);

  if (isPending || !session) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <p className="text-sm text-zinc-500">…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-12">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tutools</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {copy.signedInAs}{" "}
            <span className="font-medium text-zinc-900 dark:text-zinc-100">
              {me?.name ?? session.user.name}
            </span>
            {me?.role ? ` · ${me.role}` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={async () => {
            await signOut();
            router.replace("/login");
          }}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm transition hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          {copy.signOut}
        </button>
      </header>

      {me?.role === "TUTOR" && (
        <NewSessionForm copy={copy} onCreated={loadSessions} />
      )}

      <section className="mt-10">
        <h2 className="text-sm font-medium text-zinc-500">{copy.mySessions}</h2>
        {sessions.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">{copy.noSessions}</p>
        ) : (
          <ul className="mt-3 divide-y divide-zinc-200 dark:divide-zinc-800">
            {sessions.map((item) => (
              <SessionRow
                key={item.id}
                session={item}
                copy={copy}
                meId={me?.id}
              />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function NewSessionForm({
  copy,
  onCreated,
}: {
  copy: Dictionary;
  onCreated: () => void;
}) {
  const [studentEmail, setStudentEmail] = useState("");
  const [title, setTitle] = useState("");
  const [visibility, setVisibility] = useState<"PRIVATE" | "PUBLIC">("PRIVATE");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setPending(true);
        setError(null);
        try {
          const response = await fetch(`${API}/api/sessions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ studentEmail, title, visibility }),
          });
          if (!response.ok) {
            const body = await response.json().catch(() => null);
            setError(body?.message ?? copy.genericError);
            return;
          }
          setStudentEmail("");
          setTitle("");
          onCreated();
        } catch {
          setError(copy.genericError);
        } finally {
          setPending(false);
        }
      }}
      className="mt-8 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
    >
      <h2 className="text-sm font-medium">{copy.newSession}</h2>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="text-zinc-500">{copy.studentEmail}</span>
          <input
            type="email"
            required
            value={studentEmail}
            onChange={(event) => setStudentEmail(event.target.value)}
            className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
          />
        </label>
        <label className="text-sm">
          <span className="text-zinc-500">{copy.sessionTitle}</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
          />
        </label>
      </div>

      <label className="mt-3 block text-sm">
        <span className="text-zinc-500">{copy.visibility}</span>
        <select
          value={visibility}
          onChange={(event) =>
            setVisibility(event.target.value as "PRIVATE" | "PUBLIC")
          }
          className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
        >
          <option value="PRIVATE">{copy.visibilityPrivate}</option>
          <option value="PUBLIC">{copy.visibilityPublic}</option>
        </select>
      </label>

      {error && (
        <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-4 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {pending ? copy.loading : copy.create}
      </button>
    </form>
  );
}

function SessionRow({
  session,
  copy,
  meId,
}: {
  session: TutoringSession;
  copy: Dictionary;
  meId?: string;
}) {
  const [copied, setCopied] = useState(false);
  const closed = session.status === "ENDED" || session.status === "CANCELLED";
  const others = session.participants.filter((p) => p.userId !== meId);

  return (
    <li className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">
          {session.title ?? copy.session}
        </p>
        <p className="truncate text-xs text-zinc-500">
          {copy[`status${session.status}` as keyof Dictionary]}
          {others.length > 0 && ` · ${others.map((p) => p.user.name).join(", ")}`}
          {/* Duration only exists once the event log says the session closed —
              it is derived from webhooks, never from anyone's self-report. */}
          {session.durationSeconds !== null &&
            ` · ${copy.duration} ${formatDuration(session.durationSeconds)}`}
        </p>
      </div>

      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(
              `${window.location.origin}/session/${session.id}`,
            );
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="rounded-md px-2 py-1.5 text-xs text-zinc-500 transition hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          {copied ? copy.linkCopied : copy.copyLink}
        </button>
        {!closed && (
          <a
            href={`/session/${session.id}`}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {copy.join}
          </a>
        )}
      </div>
    </li>
  );
}

function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}`;
}
