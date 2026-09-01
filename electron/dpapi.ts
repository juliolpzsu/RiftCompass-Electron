// Windows DPAPI encrypt/decrypt for small blobs, tied to the logged-in OS
// user. Used by account.ts for the session token at rest — the token is
// never written in plaintext. Ported from
// RiftCompass-Tauri/src-tauri/src/dpapi.rs (raw Win32 CryptProtectData/
// CryptUnprotectData) to @primno/dpapi, a prebuilt binding of the exact
// same Win32 API — same one-user, no-UI-popup semantics ("CurrentUser"
// scope is the equivalent of the Rust side's default hProv/no window
// handle, and this package never shows UI either).

import { Dpapi } from "@primno/dpapi";

export function protect(plaintext: Buffer): Buffer | null {
  try {
    return Buffer.from(Dpapi.protectData(plaintext, null, "CurrentUser"));
  } catch {
    return null;
  }
}

export function unprotect(ciphertext: Buffer): Buffer | null {
  try {
    return Buffer.from(Dpapi.unprotectData(ciphertext, null, "CurrentUser"));
  } catch {
    return null;
  }
}
