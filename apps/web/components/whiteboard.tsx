"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Excalidraw, CaptureUpdateAction } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { reconcile, type SyncElement } from "@/lib/reconcile";
import type { Dictionary } from "@/lib/i18n";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/** Cursor updates are chatty; one every 50ms is smooth enough to follow. */
const POINTER_INTERVAL_MS = 50;
/** Batch local edits so a single stroke is not one message per point. */
const SEND_DEBOUNCE_MS = 120;

type ExcalidrawApi = {
  updateScene: (scene: Record<string, unknown>) => void;
  getSceneElements: () => readonly SyncElement[];
};

type Status = "connecting" | "open" | "closed";

/**
 * The shared drawing surface.
 *
 * Only changed elements are sent, and only elements — never the whole scene.
 * `appState` holds each viewer's own scroll and zoom, so broadcasting it would
 * drag everyone to one person's viewport.
 */
export default function Whiteboard({
  sessionId,
  copy,
}: {
  sessionId: string;
  copy: Dictionary;
}) {
  const [api, setApi] = useState<ExcalidrawApi | null>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const [readOnly, setReadOnly] = useState(false);

  const socketRef = useRef<WebSocket | null>(null);
  /** Version of each element as last sent, so we only send what changed. */
  const sentVersions = useRef(new Map<string, number>());
  const sendTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPointerAt = useRef(0);
  const collaborators = useRef(new Map<string, { username: string }>());

  useEffect(() => {
    if (!api) return;

    const url = new URL(`${API}/ws/whiteboard`);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("session", sessionId);

    // No token in the URL: the session cookie rides along with the upgrade
    // request, and the server runs the same checks the HTTP routes do.
    const socket = new WebSocket(url);
    socketRef.current = socket;

    socket.onopen = () => setStatus("open");
    socket.onclose = () => setStatus("closed");

    socket.onmessage = (event) => {
      const message = JSON.parse(event.data as string);

      switch (message.type) {
        case "init": {
          setReadOnly(Boolean(message.you?.readOnly));
          for (const peer of message.collaborators ?? []) {
            collaborators.current.set(peer.userId, { username: peer.name });
          }
          const elements = message.elements as SyncElement[];
          for (const element of elements) {
            sentVersions.current.set(element.id, element.version);
          }
          api.updateScene({
            elements,
            // The board's history is not this user's history — loading it must
            // not become something they can undo.
            captureUpdate: CaptureUpdateAction.NEVER,
          });
          break;
        }

        case "update": {
          const incoming = message.elements as SyncElement[];
          const merged = reconcile(api.getSceneElements(), incoming);
          // Remote edits are not local actions, so they stay out of the undo
          // stack — otherwise ctrl-Z would undo the other person's drawing.
          api.updateScene({
            elements: merged,
            captureUpdate: CaptureUpdateAction.NEVER,
          });
          // Record what we now hold, so the merge result is not echoed back as
          // though it were our own edit.
          for (const element of incoming) {
            sentVersions.current.set(element.id, element.version);
          }
          break;
        }

        case "pointer": {
          collaborators.current.set(message.userId, {
            username: message.name,
            ...(message.payload as object),
          });
          api.updateScene({ collaborators: new Map(collaborators.current) });
          break;
        }

        case "peer-joined":
          collaborators.current.set(message.userId, { username: message.name });
          api.updateScene({ collaborators: new Map(collaborators.current) });
          break;

        case "peer-left":
          collaborators.current.delete(message.userId);
          api.updateScene({ collaborators: new Map(collaborators.current) });
          break;

        case "error":
          // Read-only is the expected one; the server has the final say.
          if (message.reason === "read-only") setReadOnly(true);
          break;
      }
    };

    return () => {
      if (sendTimer.current) clearTimeout(sendTimer.current);
      socket.close();
      socketRef.current = null;
    };
  }, [api, sessionId]);

  /** Sends only elements whose version moved since we last sent them. */
  const flush = useCallback(() => {
    const socket = socketRef.current;
    if (!api || !socket || socket.readyState !== WebSocket.OPEN) return;

    const changed: SyncElement[] = [];
    for (const element of api.getSceneElements()) {
      if (sentVersions.current.get(element.id) !== element.version) {
        sentVersions.current.set(element.id, element.version);
        changed.push(element);
      }
    }
    if (changed.length > 0) {
      socket.send(JSON.stringify({ type: "update", elements: changed }));
    }
  }, [api]);

  const onChange = useCallback(() => {
    if (readOnly) return;
    if (sendTimer.current) return;
    sendTimer.current = setTimeout(() => {
      sendTimer.current = null;
      flush();
    }, SEND_DEBOUNCE_MS);
  }, [flush, readOnly]);

  const onPointerUpdate = useCallback(
    (payload: { pointer: { x: number; y: number }; button: string }) => {
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) return;

      const now = Date.now();
      if (now - lastPointerAt.current < POINTER_INTERVAL_MS) return;
      lastPointerAt.current = now;

      socket.send(JSON.stringify({ type: "pointer", payload }));
    },
    [],
  );

  return (
    <div className="relative h-full w-full">
      {status !== "open" && (
        <p className="absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-md bg-zinc-900/80 px-3 py-1 text-xs text-white">
          {status === "connecting" ? copy.connecting : copy.boardOffline}
        </p>
      )}
      <Excalidraw
        excalidrawAPI={(instance) => setApi(instance as unknown as ExcalidrawApi)}
        onChange={onChange}
        onPointerUpdate={onPointerUpdate}
        // Mirrors the server's rule so an observer is not offered tools that
        // would be rejected anyway. The server is still the enforcement.
        viewModeEnabled={readOnly}
        UIOptions={{ canvasActions: { toggleTheme: true } }}
      />
    </div>
  );
}
