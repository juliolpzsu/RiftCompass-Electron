// Renderer-side crash/error reporting — covers React errors and anything
// that throws in the UI, which electron/telemetry.ts's main-process init
// doesn't see on its own.

import * as Sentry from "@sentry/electron/renderer";
import { SENTRY_DSN } from "./shared/telemetry";

export function initTelemetry(): void {
  if (!SENTRY_DSN) return;
  Sentry.init({ dsn: SENTRY_DSN });
}
