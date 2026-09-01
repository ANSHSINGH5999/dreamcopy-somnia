const STORAGE_KEY = "dreamcopy_referrer";
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/// Stores `address` as the referrer if it's a well-formed address.
export function storeReferrer(address: string): boolean {
  if (typeof window === "undefined" || !ADDRESS_RE.test(address)) return false;
  localStorage.setItem(STORAGE_KEY, address);
  return true;
}

/// Reads ?ref=0xADDRESS from the current URL and stores it in localStorage
/// if present and well-formed. Call from ReferralBanner on every page load
/// — a later visit without ?ref keeps whatever was already stored.
export function storeReferrerFromUrl(): void {
  if (typeof window === "undefined") return;
  const ref = new URLSearchParams(window.location.search).get("ref");
  if (ref) storeReferrer(ref);
}

export function getStoredReferrer(): `0x${string}` | null {
  if (typeof window === "undefined") return null;
  const v = localStorage.getItem(STORAGE_KEY);
  return v && ADDRESS_RE.test(v) ? (v as `0x${string}`) : null;
}
