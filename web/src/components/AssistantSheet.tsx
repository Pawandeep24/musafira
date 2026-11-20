import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { AssistantPlace, AssistantRoute } from "@/api/types";
import { formatClock } from "@/lib/format";
import { parseReply, type Inline } from "@/lib/richText";
import type { AssistantMessage, AssistantState } from "@/state/useAssistant";
import { Icon } from "@/components/Icon";
import { Button } from "@/components/ui/Button";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { IconButton } from "@/components/ui/IconButton";
import { LinkButton } from "@/components/ui/LinkButton";
import { Notice } from "@/components/ui/Notice";
import { SheetHeader } from "@/components/ui/SheetHeader";

const EXAMPLES: Record<string, readonly string[]> = {
  pune: [
    "Is Koregaon Park lively around 11 pm tonight?",
    "Which pharmacies near FC Road stay open late?",
    "Safest way from Shivajinagar to Hinjewadi at 10 pm?",
    "What should I know about Shaniwar Wada?",
  ],
  bengaluru: [
    "Is Indiranagar lively around 11 pm tonight?",
    "Washrooms near MG Road open after 10 pm?",
    "Safest way from Koramangala to Whitefield at 10 pm?",
    "What should I know about Lalbagh?",
  ],
};
const ANY_CITY = ["When does it get dark today?", "Which areas do riders report as poorly lit?", "Where can I visit this evening?"];

interface Props {
  assistant: AssistantState;
  cityId: string;
  cityName: string;
  utcOffsetMinutes: number;
  onShowRoute(route: AssistantRoute): void;
}

interface PlaceProps {
  places: Record<string, AssistantPlace>;
  focused: AssistantPlace | undefined;
  onPlace(place: AssistantPlace): void;
}

function Parts({ parts, ...placeProps }: { parts: Inline[] } & PlaceProps) {
  const { places, focused, onPlace } = placeProps;
  return (
    <>
      {parts.map((part, i) => {
        if (part.kind === "text") return part.text;
        if (part.kind === "bold") {
          return (
            <strong key={i}>
              <Parts parts={part.parts} {...placeProps} />
            </strong>
          );
        }
        const place = places[part.ref];
        return (
          place && (
            <button key={i} className={`assistant__place ${focused === place ? "is-on" : ""}`} onClick={() => onPlace(place)} title="Show on the map">
              <Icon name="pin" size={12} />
              {place.name}
            </button>
          )
        );
      })}
    </>
  );
}

function Reply({ message, utcOffsetMinutes, onShowRoute, ...placeProps }: { message: AssistantMessage; utcOffsetMinutes: number; onShowRoute(route: AssistantRoute): void } & Omit<PlaceProps, "places">) {
  const { route } = message;
  const props = { ...placeProps, places: message.places };
  return (
    <div className="assistant__reply">
      {parseReply(message.text).map((block, i) =>
        block.kind === "paragraph" ? (
          <p key={i}>
            <Parts parts={block.parts} {...props} />
          </p>
        ) : (
          <ul key={i}>
            {block.items.map((item, j) => (
              <li key={j}>
                <Parts parts={item} {...props} />
              </li>
            ))}
          </ul>
        ),
      )}
      {route && (
        <Button variant="secondary" onClick={() => onShowRoute(route)}>
          <Icon name="route" size={14} /> Show this route <span className="button__meta">{formatClock(route.departAt, utcOffsetMinutes)}</span>
        </Button>
      )}
    </div>
  );
}

export function AssistantSheet({ assistant, cityId, cityName, utcOffsetMinutes, onShowRoute }: Props) {
  const { messages, steps, busy, focused } = assistant;
  const [draft, setDraft] = useState("");
  const sheetRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const sheet = sheetRef.current;
    sheet?.scrollTo({ top: sheet.scrollHeight, behavior: "smooth" });
  }, [messages.length, steps.length, busy]);

  const send = (text: string) => {
    if (busy || !text.trim()) return;
    assistant.ask(text);
    setDraft("");
  };
  const sendOnEnter = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    send(draft);
  };

  return (
    <aside ref={sheetRef} className="side-sheet glass assistant" aria-label={`Ask about ${cityName}`}>
      <IconButton icon="close" label="Close city guide" className="side-sheet__close" onClick={assistant.close} />
      <SheetHeader className="side-sheet__head" before={<Eyebrow icon="sparkle">City guide · Claude</Eyebrow>} title={`Ask about ${cityName}`}>
        <p>Claude checks Musafira's data for the hour you ask about: light, people around, signal, open places and rider reports. It can still be wrong.</p>
      </SheetHeader>

      <p className="assistant__sos">
        <Icon name="phone" size={14} /> In danger? <a href="tel:112">Call 112</a> · Women's helpline <a href="tel:1091">1091</a>
      </p>

      {messages.length === 0 && !busy && (
        <div className="assistant__examples" role="group" aria-label="Try asking">
          {(EXAMPLES[cityId] ?? ANY_CITY).map((question) => (
            <button key={question} className="assistant__example" onClick={() => send(question)}>
              {question}
            </button>
          ))}
        </div>
      )}

      {messages.length > 0 && (
        <ol className="assistant__log" aria-live="polite">
          {messages.map((message) => (
            <li key={message.id} className={`assistant__message is-${message.role}`}>
              {message.role === "user" ? (
                message.text
              ) : message.failed ? (
                <Notice tone="error">{message.text}</Notice>
              ) : (
                <Reply message={message} utcOffsetMinutes={utcOffsetMinutes} focused={focused} onPlace={assistant.focus} onShowRoute={onShowRoute} />
              )}
            </li>
          ))}
        </ol>
      )}

      {busy && (
        <ul className="assistant__steps" aria-label="Working on it">
          {steps.length === 0 && <li className="is-current">Thinking…</li>}
          {steps.map((step, i) => (
            <li key={i} className={i === steps.length - 1 ? "is-current" : ""}>
              {step}
            </li>
          ))}
        </ul>
      )}

      {messages.length > 0 && !busy && (
        <LinkButton className="assistant__clear" onClick={assistant.clear}>
          New conversation
        </LinkButton>
      )}
      {assistant.locationError && <Notice tone="error">{assistant.locationError}</Notice>}

      <form
        className="assistant__form"
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <textarea
          className="assistant__input"
          rows={2}
          maxLength={1000}
          placeholder={assistant.locating ? "Finding you…" : assistant.sharing ? "Ask about places near you…" : `Ask anything about ${cityName}…`}
          aria-label="Your question"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={sendOnEnter}
        />
        <IconButton
          icon="locate"
          label={assistant.sharing ? "Stop using my location" : "Use my location"}
          title={assistant.sharing ? "Using your location" : "Use my location"}
          aria-pressed={assistant.sharing}
          className={`assistant__locate${assistant.sharing ? " is-on" : ""}${assistant.locating ? " is-busy" : ""}`}
          onClick={assistant.toggleLocation}
        />
        <IconButton type="submit" icon="send" label="Ask" className="assistant__send" disabled={busy || !draft.trim()} />
      </form>
    </aside>
  );
}
