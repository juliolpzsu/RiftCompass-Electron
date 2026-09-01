import { useMemo, useState } from "react";
import type { ChampionInfo } from "./ddragon";
import { COLORS } from "./theme";

// A small search-by-text champion picker — native equivalent of the web
// app's ChampionCombobox (src/components/champion-combobox.tsx), same
// "type to filter, click to pick" interaction, this app's own UI.
export function ChampionCombobox({
  champions,
  value,
  onChange,
  placeholder = "Search a champion…",
}: {
  champions: ChampionInfo[];
  value: ChampionInfo | null;
  onChange: (champion: ChampionInfo | null) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const results = useMemo(() => {
    if (!query.trim()) return champions.slice(0, 30);
    const q = query.toLowerCase();
    return champions.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 30);
  }, [champions, query]);

  return (
    <div style={{ position: "relative" }}>
      {value ? (
        <button
          onClick={() => {
            onChange(null);
            setQuery("");
            setOpen(true);
          }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            width: "100%",
            background: COLORS.card,
            color: COLORS.text,
            border: `1px solid ${COLORS.cardBorder}`,
            borderRadius: 8,
            padding: "8px 12px",
            cursor: "pointer",
            font: "inherit",
            textAlign: "left",
          }}
        >
          <img src={value.iconUrl} alt="" style={{ width: 24, height: 24, borderRadius: 5 }} />
          <span style={{ fontSize: 14 }}>{value.name}</span>
        </button>
      ) : (
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={placeholder}
          style={{
            width: "100%",
            background: COLORS.card,
            color: COLORS.text,
            border: `1px solid ${COLORS.cardBorder}`,
            borderRadius: 8,
            padding: "10px 12px",
            fontSize: 14,
            boxSizing: "border-box",
          }}
        />
      )}
      {open && !value ? (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            maxHeight: 260,
            overflowY: "auto",
            background: COLORS.card,
            border: `1px solid ${COLORS.cardBorder}`,
            borderRadius: 8,
            zIndex: 10,
            boxShadow: "0 12px 24px -8px rgba(0,0,0,0.6)",
          }}
        >
          {results.length === 0 ? (
            <div style={{ padding: 12, fontSize: 13, color: COLORS.muted }}>No champions found.</div>
          ) : (
            results.map((c) => (
              <button
                key={c.id}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(c);
                  setOpen(false);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  width: "100%",
                  background: "none",
                  border: "none",
                  padding: "8px 12px",
                  cursor: "pointer",
                  color: COLORS.text,
                  font: "inherit",
                  textAlign: "left",
                }}
              >
                <img src={c.iconUrl} alt="" style={{ width: 22, height: 22, borderRadius: 5 }} />
                <span style={{ fontSize: 13 }}>{c.name}</span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
