import { useState } from "react";
import type { ContactMessage } from "@/api/types";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";

interface Props {
  to: string;
  name: string;
  email: string;
  sending: boolean;
  sentTo?: string;
  error?: string;
  onSend(message: ContactMessage): void;
  onClose(): void;
}

export function ContactDialog({ to, sending, sentTo, error, onSend, onClose, ...from }: Props) {
  const [name, setName] = useState(from.name);
  const [email, setEmail] = useState(from.email);
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState("");

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div className="dialog glass" role="dialog" aria-modal="true" aria-label="Contact us" onMouseDown={(e) => e.stopPropagation()}>
        <IconButton icon="close" label="Close" className="dialog__close" onClick={onClose} />
        {sentTo ? (
          <>
            <h2>Message sent</h2>
            <p>
              Thanks for writing. We'll reply to {sentTo} from {to}.
            </p>
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </>
        ) : (
          <>
            <h2>Contact us</h2>
            <p>Questions, feedback, or a shop to list as a Safe Stop? Your message goes to {to}.</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                onSend({ name, email, message, ...(website ? { website } : {}) });
              }}
            >
              <input required maxLength={80} placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
              <input
                type="email"
                required
                maxLength={254}
                placeholder="Your email, so we can reply"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
              <textarea
                className="contact__message"
                required
                maxLength={2000}
                rows={5}
                placeholder="Your message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
              <input className="contact__trap" tabIndex={-1} autoComplete="off" aria-hidden="true" value={website} onChange={(e) => setWebsite(e.target.value)} />
              {error && <div className="dialog__error">{error}</div>}
              <Button variant="primary" type="submit" disabled={sending} aria-busy={sending}>
                Send message
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
