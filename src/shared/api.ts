// The desktop app's one real backend: riftcompass.com's own /api/v1/*
// (see the web repo's CLAUDE.md, "API pública v1"). In the Electron app
// this lived in src/shared/ because main and renderer both imported it;
// here the Rust side will carry its own copy of this constant, so this
// file is frontend-only but keeps the same name/shape as the reference.
export const API_BASE_URL = "https://riftcompass.com";
