"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut, useSession, type Language } from "@/lib/auth-client";
import { t } from "@/lib/i18n";

type Me = {
  id: string;
  name: string;
  email: string;
  role: string;
  language: Language;
};

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export default function DashboardPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const [me, setMe] = useState<Me | null>(null);
  const [room, setRoom] = useState("demo-session");

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
  }, [session, isPending, router]);

  if (isPending || !session) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <p className="text-sm text-zinc-500">…</p>
      </main>
    );
  }

  const copy = t(me?.language ?? "FR");

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-semibold tracking-tight">Tutools</h1>

        <p className="mt-6 text-sm text-zinc-500">{copy.signedInAs}</p>
        <p className="text-lg font-medium">{me?.name ?? session.user.name}</p>
        <p className="text-sm text-zinc-500">
          {me?.email ?? session.user.email}
        </p>

        <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-zinc-200 pt-6 text-sm dark:border-zinc-800">
          <dt className="text-zinc-500">{copy.role}</dt>
          <dd className="font-medium">{me?.role ?? "…"}</dd>
          <dt className="text-zinc-500">{copy.language}</dt>
          <dd className="font-medium">{me?.language ?? "…"}</dd>
        </dl>

        <p className="mt-6 text-xs leading-relaxed text-zinc-500">
          {copy.refreshHint}
        </p>

        {/* Ad-hoc room names until step 3, where a call is attached to a
            TutoringSession row instead of being typed in by hand. */}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const name = room.trim();
            if (name) router.push(`/room/${encodeURIComponent(name)}`);
          }}
          className="mt-8 border-t border-zinc-200 pt-6 dark:border-zinc-800"
        >
          <label
            htmlFor="room"
            className="block text-sm text-zinc-500"
          >
            {copy.roomLabel}
          </label>
          <div className="mt-2 flex gap-2">
            <input
              id="room"
              value={room}
              onChange={(event) => setRoom(event.target.value)}
              placeholder="demo-session"
              pattern="[a-zA-Z0-9_-]{1,64}"
              title="Letters, digits, hyphen or underscore"
              className="min-w-0 flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
            <button
              type="submit"
              className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              {copy.joinCall}
            </button>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-zinc-500">
            {copy.reconnectHint}
          </p>
        </form>

        <button
          type="button"
          onClick={async () => {
            await signOut();
            router.replace("/login");
          }}
          className="mt-8 rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium transition hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          {copy.signOut}
        </button>
      </div>
    </main>
  );
}
