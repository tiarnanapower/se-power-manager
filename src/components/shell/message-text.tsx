// Tiny, safe renderer for the assistant's replies: paragraphs, "- " lists and
// **bold**. Everything is rendered as React text, never as HTML.
function renderInline(text: string): React.ReactNode[] {
  return text.replace(/^#{1,6}\s+/, "").split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, index) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={index}>{part.slice(2, -2)}</strong> : part.startsWith("`") && part.endsWith("`") && part.length > 2 ? <code key={index} className="pp-code">{part.slice(1, -1)}</code> : part,
  );
}

export function MessageText({ text }: { text: string }) {
  const blocks = text.trim().split(/\n{2,}/);

  return (
    <>
      {blocks.map((block, index) => {
        const lines = block.split("\n");

        if (lines.every((line) => /^\s*[-*•]\s+/.test(line))) {
          return (
            <ul key={index} style={{ margin: "0 0 8px", paddingLeft: 18 }}>
              {lines.map((line, i) => (
                <li key={i} style={{ marginBottom: 2 }}>{renderInline(line.replace(/^\s*[-*•]\s+/, ""))}</li>
              ))}
            </ul>
          );
        }

        if (lines.every((line) => /^\s*\d+[.)]\s+/.test(line))) {
          return (
            <ol key={index} style={{ margin: "0 0 8px", paddingLeft: 20 }}>
              {lines.map((line, i) => (
                <li key={i} style={{ marginBottom: 2 }}>{renderInline(line.replace(/^\s*\d+[.)]\s+/, ""))}</li>
              ))}
            </ol>
          );
        }

        if (lines.length === 1 && /^#{1,6}\s+/.test(lines[0])) {
          return <p key={index} style={{ margin: "0 0 4px", fontWeight: 700 }}>{renderInline(lines[0])}</p>;
        }

        return (
          <p key={index} style={{ margin: "0 0 8px" }}>
            {lines.map((line, i) => (
              <span key={i}>
                {i > 0 && <br />}
                {renderInline(line)}
              </span>
            ))}
          </p>
        );
      })}
    </>
  );
}
