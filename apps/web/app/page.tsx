"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/auth-client";

export default function Home() {
  const router = useRouter();
  const { data: session, isPending } = useSession();

  useEffect(() => {
    if (isPending) return;
    router.replace(session ? "/dashboard" : "/login");
  }, [session, isPending, router]);

  return (
    <main className="flex flex-1 items-center justify-center">
      <p className="text-sm text-zinc-500">…</p>
    </main>
  );
}
