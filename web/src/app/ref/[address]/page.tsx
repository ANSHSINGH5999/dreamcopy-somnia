"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { storeReferrer } from "@/lib/referral";

/// dreamcopy.xyz/ref/0xADDRESS — stores the referrer, same as ?ref=0xADDRESS
/// via ReferralBanner, then sends the visitor on to the home page. This
/// exists so the referral link on /referral matches the spec's path format;
/// the actual storage/read mechanism is identical either way.
export default function ReferralRedirectPage() {
  const params = useParams<{ address: string }>();
  const router = useRouter();

  useEffect(() => {
    storeReferrer(params.address);
    router.replace("/");
  }, [params.address, router]);

  return (
    <div className="text-sm text-stone-500">
      <p>Redirecting…</p>
    </div>
  );
}
