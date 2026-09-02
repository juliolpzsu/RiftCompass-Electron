// Main-process crash/error reporting. Errors thrown here never reach
// Chrome DevTools (see the CLAUDE.md gotcha) and this app has no other
// logger, so without this a real user's crash leaves no trace at all.

import { app } from "electron";
import * as Sentry from "@sentry/electron/main";
import { SENTRY_DSN } from "../src/shared/telemetry";

export function initTelemetry(): void {
  if (!SENTRY_DSN) return;
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: app.isPackaged ? "production" : "development",
  });
}
