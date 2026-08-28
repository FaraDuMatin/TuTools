import type { Language } from "./auth-client";

/**
 * Bilingual from the start, per the spec's constraint. Deliberately a plain
 * dictionary rather than a library — the surface is tiny today, and the point
 * is that no English string gets hardcoded into a component in the meantime.
 *
 * The user's choice lives on the User row in Postgres, so it follows them
 * across devices instead of being re-guessed from the browser.
 */
export const dictionaries = {
  EN: {
    signIn: "Sign in",
    signUp: "Create account",
    email: "Email",
    password: "Password",
    name: "Full name",
    noAccount: "No account yet?",
    haveAccount: "Already have an account?",
    signOut: "Sign out",
    session: "Session",
    role: "Role",
    language: "Language",
    signedInAs: "Signed in as",
    refreshHint:
      "Refresh this page, or open it on another device — the session is a row in Postgres, not browser state.",
    loading: "Loading…",
    genericError: "Something went wrong. Please try again.",
    passwordHint: "At least 8 characters.",
    joinCall: "Join call",
    roomLabel: "Room",
    leaveCall: "Leave",
    connecting: "Connecting…",
    joiningCall: "Joining the call…",
    callEnded: "You have left the call.",
    rejoin: "Rejoin",
    backToDashboard: "Back to dashboard",
    reconnectHint:
      "Drop your Wi-Fi mid-call and turn it back on — the call resumes without the session ending.",
  },
  FR: {
    signIn: "Se connecter",
    signUp: "Créer un compte",
    email: "Courriel",
    password: "Mot de passe",
    name: "Nom complet",
    noAccount: "Pas encore de compte ?",
    haveAccount: "Vous avez déjà un compte ?",
    signOut: "Se déconnecter",
    session: "Session",
    role: "Rôle",
    language: "Langue",
    signedInAs: "Connecté en tant que",
    refreshHint:
      "Actualisez cette page, ou ouvrez-la sur un autre appareil — la session est une ligne dans Postgres, pas un état du navigateur.",
    loading: "Chargement…",
    genericError: "Une erreur est survenue. Veuillez réessayer.",
    passwordHint: "Au moins 8 caractères.",
    joinCall: "Rejoindre l'appel",
    roomLabel: "Salle",
    leaveCall: "Quitter",
    connecting: "Connexion…",
    joiningCall: "Connexion à l'appel…",
    callEnded: "Vous avez quitté l'appel.",
    rejoin: "Revenir",
    backToDashboard: "Retour au tableau de bord",
    reconnectHint:
      "Coupez le Wi-Fi pendant l'appel puis rallumez-le — l'appel reprend sans que la séance se termine.",
  },
} as const;

export type Dictionary = (typeof dictionaries)[Language];

export const t = (language: Language): Dictionary => dictionaries[language];
