"use client";

import { useEffect, useState } from "react";
import { getStoredReferrer, storeReferrerFromUrl } from "@/lib/referral";

function short(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/// Captures ?ref=0xADDRESS on load (any page) and shows a small banner once
/// stored. The actual fee/credit only happens once, on the referred
/// wallet's first deposit — see DepositModal, which reads the stored
/// referrer via getStoredReferrer and calls depositWithReferral.
export function ReferralBanner() {
  const [referrer, setReferrer] = useState<string | null>(null);

  useEffect(() => {
    storeReferrerFromUrl();
    setReferrer(getStoredReferrer());
  }, []);

  if (!referrer) return null;

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-100 px-4 py-3 text-sm text-blue-600">
      You were referred by <span className="font-mono">{short(referrer)}</span> — on your first deposit they&apos;ll
      earn 0.5% of it.
    </div>
  );
}
