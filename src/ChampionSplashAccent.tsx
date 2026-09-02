import type { CSSProperties } from "react";

// Ported from the web app's src/components/champion-splash-accent.tsx —
// same real Community Dragon splash art, same radial fade mask so it
// blends into the background instead of reading as a hard rectangle,
// same "decoration only, never the focal point" role: fills otherwise-
// flat empty space around narrower tool content instead of leaving it
// bare.
//
// Uses Community Dragon's `/splash-art/centered` crop (1280x720, the
// champion reliably centered regardless of composition): no per-champion
// object-position tuning generalizes, because a champion's face sits in a
// different spot on every splash (Vi's near-center vs. Ahri's upper-left).
export function ChampionSplashAccent({
  championId,
  style,
  opacity = 22,
}: {
  championId: string;
  style: CSSProperties;
  opacity?: number;
}) {
  return (
    <img
      aria-hidden
      src={`https://cdn.communitydragon.org/latest/champion/${championId}/splash-art/centered`}
      alt=""
      style={{
        position: "absolute",
        zIndex: -1,
        pointerEvents: "none",
        objectFit: "cover",
        // Opaque core widened from 35%: a face sitting anywhere past it
        // was landing in the fade-to-transparent band and reading as
        // smudged rather than just softly vignetted.
        // 5 stops, not 2 (same fix as the web app's version, 2026-09-02):
        // a straight `black 48%, transparent 100%` ramp drops alpha at a
        // constant rate, and the eye's own edge enhancement turns the
        // point where that ramp ends into a visible ring against the
        // page background — an eased curve (fast drop, then a long soft
        // tail to true zero) avoids it.
        maskImage:
          "radial-gradient(ellipse 55% 55% at 50% 50%, black 48%, rgba(0,0,0,0.7) 62%, rgba(0,0,0,0.35) 78%, rgba(0,0,0,0.1) 90%, transparent 100%)",
        WebkitMaskImage:
          "radial-gradient(ellipse 55% 55% at 50% 50%, black 48%, rgba(0,0,0,0.7) 62%, rgba(0,0,0,0.35) 78%, rgba(0,0,0,0.1) 90%, transparent 100%)",
        opacity: opacity / 100,
        maxWidth: "none",
        maxHeight: "none",
        ...style,
      }}
    />
  );
}
