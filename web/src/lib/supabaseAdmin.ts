import "server-only";
import { createClient } from "@supabase/supabase-js";

// Secret key — bypasses RLS. Import ONLY from route handlers (the
// "server-only" import above makes accidentally bundling this into client
// code a build error, not just a convention). Used exclusively by
// web/src/app/api/notify/* — never by anything under src/components or a
// page rendered client-side. See docs/supabase_schema.sql's
// notification_prefs comment for why writes must not go through the
// publishable key.
const url = process.env.SUPABASE_URL ?? "";
const secretKey = process.env.SUPABASE_SECRET_KEY ?? "";

export const SUPABASE_ADMIN_CONFIGURED = Boolean(url && secretKey);

export const supabaseAdmin = SUPABASE_ADMIN_CONFIGURED
  ? createClient(url, secretKey, { auth: { persistSession: false } })
  : null;
