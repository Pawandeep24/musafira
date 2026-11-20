import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/api/client";
import type { AssistantPlace, AssistantRoute, AssistantTurn, LngLat } from "@/api/types";
import { replyText } from "@/lib/richText";

const MAX_TURNS = 12;
const MAX_REPLY_CHARS = 4000;

export interface AssistantMessage {
  id: number;
  role: "user" | "assistant";
  text: string;
  places: Record<string, AssistantPlace>;
  route?: AssistantRoute;
  failed?: boolean;
}

function historyOf(messages: readonly AssistantMessage[]): AssistantTurn[] {
  const turns = messages
    .filter((m) => !m.failed)
    .map((m) => ({ role: m.role, text: m.role === "assistant" ? replyText(m.text, m.places).slice(0, MAX_REPLY_CHARS) : m.text }))
    .slice(-MAX_TURNS);
  while (turns[0]?.role === "assistant") turns.shift();
  return turns;
}

export function useAssistant(cityId: string | undefined) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [steps, setSteps] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState<AssistantPlace>();
  const [sharing, setSharing] = useState(false);
  const [here, setHere] = useState<LngLat>();
  const [locationError, setLocationError] = useState<string>();
  const pending = useRef<AbortController | undefined>(undefined);
  const watch = useRef<number | undefined>(undefined);
  const nextId = useRef(0);

  const stop = () => {
    pending.current?.abort();
    pending.current = undefined;
    setBusy(false);
    setSteps([]);
  };

  const stopSharing = () => {
    if (watch.current !== undefined) navigator.geolocation.clearWatch(watch.current);
    watch.current = undefined;
    setSharing(false);
    setHere(undefined);
  };

  const toggleLocation = () => {
    setLocationError(undefined);
    if (sharing) return stopSharing();
    if (!navigator.geolocation) return setLocationError("Location isn't available in this browser. Name a place instead.");
    setSharing(true);
    watch.current = navigator.geolocation.watchPosition(
      ({ coords }) => setHere([coords.longitude, coords.latitude]),
      () => {
        stopSharing();
        setLocationError("Couldn't get your location. Name a place instead.");
      },
      { maximumAge: 60_000 },
    );
  };

  useEffect(() => {
    stop();
    setMessages([]);
    setFocused(undefined);
    return () => pending.current?.abort();
  }, [cityId]);

  useEffect(
    () => () => {
      if (watch.current !== undefined) navigator.geolocation.clearWatch(watch.current);
    },
    [],
  );

  const add = (message: Omit<AssistantMessage, "id">) => setMessages((list) => [...list, { ...message, id: nextId.current++ }]);
  const fail = (text: string) => add({ role: "assistant", text, places: {}, failed: true });

  const ask = (text: string) => {
    const question = text.trim();
    if (!cityId || !question || pending.current) return;
    const user = { role: "user" as const, text: question, places: {} };
    const turns = historyOf([...messages, { ...user, id: -1 }]);
    add(user);
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setSteps([]);
    setFocused(undefined);
    let replied = false;
    api
      .ask(
        { cityId, messages: turns, ...(here ? { location: here } : {}) },
        (event) => {
          if (controller.signal.aborted) return;
          if (event.type === "step") return setSteps((list) => [...list, event.label]);
          replied = true;
          if (event.type === "error") return fail(event.message);
          add({ role: "assistant", text: event.text, places: event.places, ...(event.route ? { route: event.route } : {}) });
        },
        controller.signal,
      )
      .then(() => {
        if (!replied && !controller.signal.aborted) fail("The answer got cut off. Try asking again.");
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted) fail(e instanceof ApiError ? e.message : "Couldn't reach the city guide. Check your connection.");
      })
      .finally(() => {
        if (pending.current !== controller) return;
        pending.current = undefined;
        setBusy(false);
        setSteps([]);
      });
  };

  return {
    open,
    messages,
    steps,
    busy,
    focused,
    sharing,
    locating: sharing && !here,
    locationError,
    ask,
    focus: setFocused,
    toggleLocation,
    start: () => setOpen(true),
    close() {
      stop();
      stopSharing();
      setLocationError(undefined);
      setOpen(false);
      setFocused(undefined);
    },
    clear() {
      stop();
      setMessages([]);
      setFocused(undefined);
    },
  };
}

export type AssistantState = ReturnType<typeof useAssistant>;
