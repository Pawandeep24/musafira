import { useState } from "react";
import { api, ApiError } from "@/api/client";
import type { ContactMessage } from "@/api/types";

const failure = (error: unknown) => {
  if (!(error instanceof ApiError)) return "Couldn't send your message. Check your connection and try again.";
  if (error.status === 429) return "You've sent a few messages already. Please try again in an hour.";
  if (error.status === 400) return "Check your name, email and message, then try again.";
  return "Couldn't send your message right now. Please try again in a few minutes.";
};

export function useContact() {
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string>();
  const [error, setError] = useState<string>();

  return {
    open,
    sending,
    sentTo,
    error,
    start: () => setOpen(true),
    close() {
      setOpen(false);
      setSentTo(undefined);
      setError(undefined);
    },
    async send(message: ContactMessage) {
      setSending(true);
      setError(undefined);
      try {
        await api.contact(message);
        setSentTo(message.email);
      } catch (e) {
        setError(failure(e));
      } finally {
        setSending(false);
      }
    },
  };
}
