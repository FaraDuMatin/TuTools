"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ConnectionStateToast,
  ControlBar,
  LiveKitRoom,
  ParticipantTile,
  RoomAudioRenderer,
  usePersistentUserChoices,
  useTracks,
} from "@livekit/components-react";
import { Room, Track } from "livekit-client";
import "@livekit/components-styles";
import { useSession, type Language } from "@/lib/auth-client";
import { t } from "@/lib/i18n";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

type Credentials = { token: string; url: string };

/**
 * The call screen.
 *
 * The browser never holds a LiveKit key. It asks Nest for a token scoped to
 * this one room, and Nest signs it with a secret that stays server-side — the
 * same rule as every other permission in this app.
 */
export default function RoomPage() {
  const router = useRouter();
  const params = useParams<{ roomId: string }>();
  const roomId = params.roomId;

  const { data: session, isPending } = useSession();
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState(false);

  const language = (session?.user.language as Language) ?? "FR";
  const copy = t(language);

  // We own the Room rather than letting LiveKitRoom create one, so that
  // releasing the camera is our decision and not a side effect of unmounting.
  const room = useMemo(() => new Room(), []);

  /**
   * The camera must not switch itself back on.
   *
   * ControlBar already writes the user's mic/camera choice to local storage;
   * nothing was reading it back, so every mount — a refresh, a rejoin, or a dev
   * hot reload — re-enabled the camera against the user's wishes. Someone who
   * turns their camera off in a tutoring session has to stay off.
   */
  const { userChoices } = usePersistentUserChoices();

  const videoOption = userChoices.videoEnabled
    ? userChoices.videoDeviceId
      ? { deviceId: userChoices.videoDeviceId }
      : true
    : false;

  const audioOption = userChoices.audioEnabled
    ? userChoices.audioDeviceId
      ? { deviceId: userChoices.audioDeviceId }
      : true
    : false;

  /**
   * Turns the camera light off.
   *
   * `disconnect()` is supposed to stop local tracks, but we tear the room UI
   * down inside the `onDisconnected` handler, which can cut that teardown short
   * and leave the capture device held open. Stopping the MediaStreamTracks
   * ourselves is idempotent and makes the release unconditional — a camera that
   * stays live after a tutoring session ends is not a cosmetic bug.
   */
  const releaseMedia = useCallback(() => {
    room.localParticipant.trackPublications.forEach((publication) => {
      publication.track?.stop();
    });
  }, [room]);

  // Only true once we have actually been in the call. React Strict Mode runs
  // every effect's cleanup once immediately after mount, so an unguarded
  // cleanup here tears the room down before it ever connects — which presents
  // as a permanent "Connecting" toast.
  const wasConnected = useRef(false);

  // Covers navigating away and closing the tab, where onDisconnected never
  // fires. Stops the capture devices only; the connection itself is
  // LiveKitRoom's to manage.
  useEffect(() => {
    return () => {
      if (wasConnected.current) releaseMedia();
    };
  }, [releaseMedia]);

  useEffect(() => {
    const release = () => {
      if (wasConnected.current) releaseMedia();
    };
    // 'pagehide' rather than 'beforeunload': it fires on mobile Safari and on
    // back/forward navigation, where beforeunload does not.
    window.addEventListener("pagehide", release);
    return () => window.removeEventListener("pagehide", release);
  }, [releaseMedia]);

  const fetchToken = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch(`${API}/api/rtc/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ room: roomId }),
      });
      if (!response.ok) {
        setError(copy.genericError);
        return;
      }
      setCredentials((await response.json()) as Credentials);
    } catch {
      setError(copy.genericError);
    }
  }, [roomId, copy.genericError]);

  useEffect(() => {
    if (isPending) return;
    if (!session) {
      router.replace("/login");
      return;
    }
    void fetchToken();
  }, [session, isPending, router, fetchToken]);

  if (isPending || !session) {
    return <Centered>{copy.loading}</Centered>;
  }

  if (error) {
    return (
      <Centered>
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        <button
          type="button"
          onClick={() => void fetchToken()}
          className="mt-4 rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium transition hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          {copy.rejoin}
        </button>
      </Centered>
    );
  }

  // Leaving is an explicit choice, so we stop and offer a way back rather than
  // silently reconnecting. A *dropped* connection is different: LiveKit retries
  // on its own and never reaches this branch.
  if (left) {
    return (
      <Centered>
        <p className="text-sm text-zinc-500">{copy.callEnded}</p>
        <div className="mt-4 flex gap-3">
          <button
            type="button"
            onClick={() => {
              setLeft(false);
              void fetchToken();
            }}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium transition hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            {copy.rejoin}
          </button>
          <button
            type="button"
            onClick={() => router.push("/dashboard")}
            className="rounded-md px-4 py-2 text-sm text-zinc-500 transition hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            {copy.backToDashboard}
          </button>
        </div>
      </Centered>
    );
  }

  if (!credentials) {
    return <Centered>{copy.joiningCall}</Centered>;
  }

  return (
    <div className="flex h-dvh flex-col" data-lk-theme="default">
      <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-2 text-sm dark:border-zinc-800">
        <span className="text-zinc-500">
          {copy.roomLabel}: <span className="font-medium">{roomId}</span>
        </span>
        <span className="text-zinc-500">{session.user.name}</span>
      </header>

      <LiveKitRoom
        room={room}
        token={credentials.token}
        serverUrl={credentials.url}
        connect
        audio={audioOption}
        video={videoOption}
        onConnected={() => {
          wasConnected.current = true;
        }}
        // Fires on an explicit leave *and* on an unrecoverable drop — after
        // LiveKit has exhausted its own retries, not on the first blip.
        onDisconnected={() => {
          releaseMedia();
          setLeft(true);
        }}
        className="flex flex-1 flex-col overflow-hidden"
      >
        <Stage />
        {/* Without this there is no sound: it is what actually attaches remote
            audio tracks to the page. */}
        <RoomAudioRenderer />
        {/* saveUserChoices is the other half of usePersistentUserChoices above:
            it writes the toggle back to local storage so the choice survives. */}
        <ControlBar variation="minimal" saveUserChoices />
        {/* Surfaces "Reconnecting…" so a blip is visibly survived rather than
            looking like a freeze. */}
        <ConnectionStateToast />
      </LiveKitRoom>
    </div>
  );
}

/**
 * Deliberately not `GridLayout` or the `VideoConference` prefab.
 *
 * Both run tracks through the library's pagination, which sorts for "visual
 * stability" and throws `Element not part of the array` when a participant's
 * placeholder tile is replaced by a real camera track — i.e. every time someone
 * joins or leaves. That is a render-time crash on the exact event a tutoring
 * call must survive.
 *
 * A 1:1 session has nothing to paginate, so we map the tracks ourselves and
 * skip that code path entirely.
 */
function Stage() {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );

  return (
    <div className="flex-1 overflow-auto p-2">
      <div className="grid h-full gap-2 grid-cols-[repeat(auto-fit,minmax(280px,1fr))]">
        {tracks.map((track) => (
          <ParticipantTile
            // Placeholder and real tracks must produce different keys, or React
            // reuses the tile and the video element never re-attaches.
            key={`${track.participant.identity}:${track.source}:${
              track.publication?.trackSid ?? "placeholder"
            }`}
            trackRef={track}
            className="overflow-hidden rounded-lg bg-zinc-900"
          />
        ))}
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      {children}
    </main>
  );
}
