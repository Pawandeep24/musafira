/**
 * The city assistant's replies as blocks to render: one paragraph per line, "- " lines as a list,
 * with **bold** and [[p3]] place refs as inline parts. Never HTML, so a reply can't inject markup.
 */
export type Inline = { kind: "text"; text: string } | { kind: "place"; ref: string } | { kind: "bold"; parts: Inline[] };
export type Block = { kind: "paragraph"; parts: Inline[] } | { kind: "list"; items: Inline[][] };

const PLACE = /\[\[(p\d+)\]\]/g;
const BOLD_OR_PLACE = /\*\*(.+?)\*\*|\[\[(p\d+)\]\]/g;

function split(text: string, pattern: RegExp, partOf: (match: RegExpExecArray) => Inline): Inline[] {
  const parts: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) parts.push({ kind: "text", text: text.slice(last, match.index) });
    parts.push(partOf(match));
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ kind: "text", text: text.slice(last) });
  return parts;
}

const withPlaces = (text: string) => split(text, PLACE, ([, ref]) => ({ kind: "place", ref: ref! }));
const inline = (text: string) =>
  split(text, BOLD_OR_PLACE, ([, bold, ref]) => (bold !== undefined ? { kind: "bold", parts: withPlaces(bold) } : { kind: "place", ref: ref! }));

export function parseReply(text: string): Block[] {
  const blocks: Block[] = [];
  for (const line of text.split("\n").map((l) => l.trim())) {
    if (!line) continue;
    const bullet = /^[-*•]\s+(.+)$/.exec(line)?.[1];
    const previous = blocks.at(-1);
    if (bullet === undefined) blocks.push({ kind: "paragraph", parts: inline(line) });
    else if (previous?.kind === "list") previous.items.push(inline(bullet));
    else blocks.push({ kind: "list", items: [inline(bullet)] });
  }
  return blocks;
}

/** The reply as plain text for the next question's history, place refs swapped for their names. */
export const replyText = (text: string, places: Readonly<Record<string, { name: string }>>) =>
  text.replace(PLACE, (_, ref: string) => places[ref]?.name ?? "");
