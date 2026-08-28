"use client";

import { createAuthClient } from "better-auth/react";
import { inferAdditionalFields } from "better-auth/client/plugins";

/**
 * Talks to NestJS. Next renders, Nest decides — there are no API routes or
 * server actions in this app, so every call leaves for the backend.
 */
export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001",
  basePath: "/api/auth",
  fetchOptions: {
    // Nest is a different origin in dev (3000 vs 3001); without this the
    // session cookie never rides along.
    credentials: "include",
  },
  plugins: [
    // Teaches the client about the columns we added to User. Declared by hand
    // because web and api are separate packages with no shared types yet;
    // `role` is listed so it can be read, never sent — the server refuses it
    // as input.
    inferAdditionalFields({
      user: {
        // Mirrors the server config in apps/api/src/auth/auth.ts. `input: false`
        // is what keeps `role` readable but unsendable — omit it and the client
        // types would demand a role on signup, which the server would refuse.
        role: { type: "string", required: false, input: false },
        language: { type: "string", required: false },
      },
    }),
  ],
});

export const { signIn, signUp, signOut, useSession } = authClient;

export type Role = "TUTOR" | "STUDENT" | "PARENT" | "CEO";
export type Language = "EN" | "FR";
