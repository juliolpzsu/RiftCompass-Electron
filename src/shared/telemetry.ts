// A Sentry DSN identifies where to send events, not a secret — it's meant
// to ship inside client apps (same as any web app's client-side Sentry
// init). Empty until a Sentry project exists for this app; both
// electron/telemetry.ts and src/telemetry.ts no-op when it's empty, so
// nothing breaks before it's filled in.
export const SENTRY_DSN =
  "https://4e171c8a6079cdfdfe81837eadf054ea@o4512012979208192.ingest.de.sentry.io/4512012986810448";
