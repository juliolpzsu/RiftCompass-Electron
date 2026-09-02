// Windows DPAPI encrypt/decrypt for small blobs, tied to the logged-in OS
// user. Used by account.ts for the session token at rest — the token is
// never written in plaintext. @primno/dpapi is a prebuilt binding of the
// Win32 CryptProtectData/CryptUnprotectData pair; "CurrentUser" scope
// means only the same Windows account can decrypt, and no UI is ever
// shown.

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
