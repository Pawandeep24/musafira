import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { AppConfig, ParameterId, Preferences, Preset, ScoringOptions } from "../api/types";
import type { AuthState } from "../auth/useAuth";

const STORAGE_KEY = "musafira.profile.v1";
const REMOTE_SAVE_DELAY_MS = 800;

export type SyncState = "device" | "syncing" | "synced" | "error";

function readLocal(defaults: AppConfig["defaults"]): Preferences | undefined {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<Preferences> | null;
    if (!stored) return undefined;
    return {
      weights: { ...defaults.weights, ...stored.weights },
      options: { ...defaults.options, ...stored.options },
      ...(stored.presetId ? { presetId: stored.presetId } : {}),
    };
  } catch {
    return undefined;
  }
}

/** Guests keep their safety weights in this browser; signed-in riders also sync them to their account. */
export function useSafetyProfile(defaults: AppConfig["defaults"] | undefined, auth: AuthState) {
  const [profile, setProfile] = useState<Preferences>();
  const [sync, setSync] = useState<SyncState>("device");
  const fromRemote = useRef(false);

  useEffect(() => {
    if (defaults && !profile) setProfile(readLocal(defaults) ?? { ...defaults, presetId: "balanced" });
  }, [defaults]);

  const uid = auth.user?.uid;
  useEffect(() => {
    if (!uid || !profile) {
      setSync("device");
      return;
    }
    let cancelled = false;
    setSync("syncing");
    (async () => {
      const token = await auth.idToken();
      if (!token) return;
      const remote = await api.getPreferences(token);
      if (cancelled) return;
      if (remote) {
        fromRemote.current = true;
        setProfile(remote);
      } else {
        await api.savePreferences(token, profile);
      }
      setSync("synced");
    })().catch(() => !cancelled && setSync("error"));
    return () => {
      cancelled = true;
    };
  }, [uid, Boolean(profile)]);

  useEffect(() => {
    if (!profile) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    if (!uid || fromRemote.current) {
      fromRemote.current = false;
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const token = await auth.idToken();
        if (!token) return;
        setSync("syncing");
        await api.savePreferences(token, profile);
        setSync("synced");
      } catch {
        setSync("error");
      }
    }, REMOTE_SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [profile]);

  return {
    profile,
    sync,
    setWeight: (id: ParameterId, value: number) =>
      setProfile((p) => p && { weights: { ...p.weights, [id]: value }, options: p.options }),
    setOption: (key: keyof ScoringOptions, value: number) =>
      setProfile((p) => p && { ...p, options: { ...p.options, [key]: value } }),
    applyPreset: (preset: Preset) => setProfile((p) => p && { weights: preset.weights, options: p.options, presetId: preset.id }),
  };
}
