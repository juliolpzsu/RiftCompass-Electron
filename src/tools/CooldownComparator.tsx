import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { ChampionCombobox } from "../ChampionCombobox";
import {
  fetchChampionDetail,
  fetchChampionMap,
  fetchLatestVersion,
  spellIconUrl,
  type ChampionDetail,
  type ChampionInfo,
} from "../ddragon";
import { useI18n } from "../i18n";
import { COLORS } from "../theme";

// Ported from the web app's src/lib/riot/ddragon.ts's effectiveCooldown —
// same formula and the same [0,200] ability-haste clamp fixed there after
// a real bug was found (haste <= -100 made the denominator zero/negative,
// showing Infinity or a negative cooldown).
function effectiveCooldown(base: number, abilityHaste: number): number {
  return Math.round((base / (1 + abilityHaste / 100)) * 10) / 10;
}

function clampHaste(value: number): number {
  return Math.min(200, Math.max(0, value));
}

const SPELL_KEYS = ["Q", "W", "E", "R"];

export function CooldownComparator() {
  const [champions, setChampions] = useState<ChampionInfo[]>([]);
  const [version, setVersion] = useState("");

  useEffect(() => {
    fetchLatestVersion().then((v) => {
      setVersion(v);
      fetchChampionMap().then((m) => setChampions(Object.values(m.byId)));
    });
  }, []);

  return (
    // A vertical divider between the two columns instead of no separation
    // at all, now that neither panel sits in its own bordered card (web's
    // 2026-09-01 redesign added the same `sm:divide-x` — a plain gap alone
    // left the two panels looking unrelated instead of one A/B comparison).
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(280px, 1fr))", gap: 32 }}>
      <ChampionCooldownPanel slot="A" champions={champions} version={version} />
      <div style={{ borderLeft: `1px solid ${COLORS.cardBorder}`, paddingLeft: 32, marginLeft: -32 }}>
        <ChampionCooldownPanel slot="B" champions={champions} version={version} />
      </div>
    </div>
  );
}

function ChampionCooldownPanel({
  slot,
  champions,
  version,
}: {
  slot: "A" | "B";
  champions: ChampionInfo[];
  version: string;
}) {
  const { t } = useI18n();
  const [champion, setChampion] = useState<ChampionInfo | null>(null);
  const [detail, setDetail] = useState<ChampionDetail | null>(null);
  const [abilityHaste, setAbilityHaste] = useState(0);
  const [loading, setLoading] = useState(false);
  // One rank pip-picker per ability (like the in-game skill points),
  // index-matched to detail.spells, defaulting to rank 1 on a fresh pick.
  const [selectedRanks, setSelectedRanks] = useState<number[]>([]);

  useEffect(() => {
    if (!champion || !version) {
      setDetail(null);
      setSelectedRanks([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchChampionDetail(version, champion.internalId)
      .then((data) => {
        if (!cancelled) {
          setDetail(data);
          setSelectedRanks(data.spells.map(() => 1));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [champion, version]);

  function setRank(spellIndex: number, rank: number) {
    setSelectedRanks((prev) => prev.map((r, i) => (i === spellIndex ? rank : r)));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <span style={{ fontSize: 13, color: COLORS.muted }}>{t("Cooldowns.championLabel", { slot })}</span>
      <ChampionCombobox champions={champions} value={champion} onChange={setChampion} placeholder={t("Cooldowns.selectPlaceholder")} />

      {/* Always-visible custom stepper so there's no doubt the value is
          editable — the native number-input spinner is suppressed via
          -webkit-appearance so the two don't double up. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <label style={{ flex: 1, fontSize: 13, color: COLORS.muted }}>{t("Cooldowns.abilityHasteLabel")}</label>
        <div style={{ display: "flex", alignItems: "center" }}>
          <input
            type="number"
            min={0}
            max={200}
            value={abilityHaste}
            onChange={(e) => setAbilityHaste(clampHaste(Number(e.target.value) || 0))}
            className="rc-no-spinner"
            style={{
              width: 40,
              background: "none",
              color: COLORS.text,
              border: "none",
              borderBottom: `1px solid ${COLORS.cardBorder}`,
              padding: "4px 2px",
              fontSize: 13,
              textAlign: "right",
            }}
          />
          <div style={{ display: "flex", flexDirection: "column" }}>
            <button
              type="button"
              onClick={() => setAbilityHaste((prev) => clampHaste(prev + 1))}
              aria-label={t("Cooldowns.increaseHaste")}
              style={{ background: "none", border: "none", color: COLORS.muted, cursor: "pointer", padding: 0, display: "flex" }}
            >
              <ChevronUp size={13} />
            </button>
            <button
              type="button"
              onClick={() => setAbilityHaste((prev) => clampHaste(prev - 1))}
              aria-label={t("Cooldowns.decreaseHaste")}
              style={{ background: "none", border: "none", color: COLORS.muted, cursor: "pointer", padding: 0, display: "flex" }}
            >
              <ChevronDown size={13} />
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <p style={{ fontSize: 13, color: COLORS.muted }}>{t("Cooldowns.loading")}</p>
      ) : detail ? (
        <ul style={{ display: "flex", flexDirection: "column", gap: 10, margin: 0, padding: 0, listStyle: "none" }}>
          {detail.spells.map((spell, index) => {
            const rank = selectedRanks[index] ?? 1;
            const baseCooldown = spell.cooldown[rank - 1];
            const withHaste = abilityHaste > 0 ? effectiveCooldown(baseCooldown, abilityHaste) : null;
            return (
              <li key={spell.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span
                  style={{
                    width: 22,
                    height: 22,
                    flexShrink: 0,
                    borderRadius: 6,
                    background: `${COLORS.rose}1a`,
                    color: COLORS.rose,
                    fontSize: 11,
                    fontWeight: 600,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {SPELL_KEYS[index]}
                </span>
                <img
                  src={spellIconUrl(version, spell.image.full)}
                  alt={spell.name}
                  style={{ width: 34, height: 34, borderRadius: 6, border: `1px solid ${COLORS.cardBorder}` }}
                />
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{spell.name}</span>
                  {/* Clickable rank pips, same visual language as the
                      client's own level-up UI (filled = points already
                      put in). Clicking pip N shows that rank's cooldown. */}
                  <div style={{ display: "flex", gap: 3 }}>
                    {spell.cooldown.map((_, rankIndex) => {
                      const pipRank = rankIndex + 1;
                      const filled = pipRank <= rank;
                      return (
                        <button
                          key={pipRank}
                          type="button"
                          onClick={() => setRank(index, pipRank)}
                          aria-label={t("Cooldowns.rankLabel", { rank: pipRank })}
                          title={t("Cooldowns.rankLabel", { rank: pipRank })}
                          style={{
                            width: 18,
                            height: 10,
                            borderRadius: 2,
                            border: "none",
                            cursor: "pointer",
                            background: filled ? COLORS.rose : `${COLORS.muted}40`,
                          }}
                        />
                      );
                    })}
                  </div>
                </div>
                <span style={{ textAlign: "right", fontSize: 13, fontWeight: 500 }}>
                  {withHaste !== null ? (
                    <>
                      <span style={{ color: COLORS.gold }}>{withHaste}s</span>
                      <span style={{ display: "block", fontSize: 11, fontWeight: 400, color: COLORS.muted }}>
                        {t("Cooldowns.withHaste")}
                      </span>
                    </>
                  ) : (
                    <span style={{ color: COLORS.muted }}>{baseCooldown}s</span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p style={{ fontSize: 13, color: COLORS.muted }}>{t("Cooldowns.emptyState")}</p>
      )}
    </div>
  );
}
