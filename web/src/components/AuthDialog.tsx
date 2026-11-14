import { useState } from "react";
import type { AuthState } from "../auth/useAuth";
import { Icon } from "./Icon";

const friendly = (error: unknown) => {
  const code = (error as { code?: string }).code ?? "";
  if (code.includes("invalid-credential") || code.includes("wrong-password")) return "That email and password don't match.";
  if (code.includes("email-already-in-use")) return "An account already exists for this email. Sign in instead.";
  if (code.includes("weak-password")) return "Use at least 6 characters for your password.";
  if (code.includes("popup-closed")) return "Sign-in window was closed.";
  if (code.includes("operation-not-allowed")) return "This sign-in method isn't enabled for the project yet.";
  return "Couldn't sign you in. Please try again.";
};

export type AuthPurpose = "sync" | "report";

const COPY: Record<AuthPurpose, { title: string; body: string }> = {
  sync: {
    title: "Keep your safety DNA everywhere",
    body: "Optional. Musafira works fully without an account; signing in only syncs your preferences across devices.",
  },
  report: {
    title: "Sign in to report",
    body: "An account stops one person flooding the map. Reports are saved without your name or email, and planning routes never needs sign-in.",
  },
};

interface Props {
  auth: AuthState;
  purpose?: AuthPurpose;
  onSignedIn?(): void;
  onClose(): void;
}

export function AuthDialog({ auth, purpose = "sync", onSignedIn, onClose }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
      onClose();
      onSignedIn?.();
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div className="dialog glass" role="dialog" aria-modal="true" aria-label="Sign in" onMouseDown={(e) => e.stopPropagation()}>
        <button className="icon-button dialog__close" onClick={onClose} aria-label="Close">
          <Icon name="close" size={16} />
        </button>
        <h2>{COPY[purpose].title}</h2>
        <p>{COPY[purpose].body}</p>
        <button className="button button--light" disabled={busy} aria-busy={busy} onClick={() => run(auth.signInWithGoogle)}>
          Continue with Google
        </button>
        <div className="dialog__divider">or</div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => auth.signInWithEmail(email, password, creating));
          }}
        >
          <input type="email" required placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          <input
            type="password"
            required
            minLength={6}
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={creating ? "new-password" : "current-password"}
          />
          {error && <div className="dialog__error">{error}</div>}
          <button className="button button--primary" disabled={busy} aria-busy={busy} type="submit">
            {creating ? "Create account" : "Sign in"}
          </button>
        </form>
        <button className="link-button" onClick={() => setCreating((c) => !c)}>
          {creating ? "I already have an account" : "New here? Create an account"}
        </button>
      </div>
    </div>
  );
}
