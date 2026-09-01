"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";

interface Prefs {
  telegram_chat_id: string;
  notify_on_copy: boolean;
  notify_on_stop_loss: boolean;
  notify_on_referral: boolean;
  min_trade_size: string;
}

const DEFAULT_PREFS: Prefs = {
  telegram_chat_id: "",
  notify_on_copy: true,
  notify_on_stop_loss: true,
  notify_on_referral: true,
  min_trade_size: "0",
};

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-violet-600"
      />
      <span className="text-sm text-stone-700">{label}</span>
    </label>
  );
}

export default function SettingsPage() {
  const { address, isConnected } = useAccount();
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<"ok" | "error" | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"ok" | "error" | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    fetch(`/api/notify/prefs?wallet=${address}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) {
          setLoadError(data.error);
          return;
        }
        setPrefs({
          telegram_chat_id: data.telegram_chat_id ?? "",
          notify_on_copy: data.notify_on_copy ?? true,
          notify_on_stop_loss: data.notify_on_stop_loss ?? true,
          notify_on_referral: data.notify_on_referral ?? true,
          min_trade_size: String(data.min_trade_size ?? 0),
        });
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [address]);

  const save = async () => {
    if (!address) return;
    setSaving(true);
    setSaveResult(null);
    setSaveError(null);
    try {
      const res = await fetch("/api/notify/prefs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet: address,
          telegram_chat_id: prefs.telegram_chat_id.trim() || null,
          notify_on_copy: prefs.notify_on_copy,
          notify_on_stop_loss: prefs.notify_on_stop_loss,
          notify_on_referral: prefs.notify_on_referral,
          min_trade_size: Number(prefs.min_trade_size) || 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setSaveResult("ok");
    } catch (err) {
      setSaveResult("error");
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    setTestResult(null);
    setTestError(null);
    try {
      const res = await fetch("/api/notify/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: prefs.telegram_chat_id.trim() }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error ?? `HTTP ${res.status}`);
      setTestResult("ok");
    } catch (err) {
      setTestResult("error");
      setTestError(err instanceof Error ? err.message : String(err));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-semibold text-stone-900">Settings</h1>
        <p className="mt-2 text-sm text-stone-500">
          Notification preferences are per-wallet, stored server-side (see{" "}
          <code className="rounded bg-stone-100 px-1">docs/supabase_schema.sql</code>) — the browser never writes
          these directly.
        </p>
      </div>

      {!isConnected || !address ? (
        <p className="text-sm text-stone-500">Connect your wallet to manage notification settings.</p>
      ) : loading ? (
        <p className="text-sm text-stone-500">Loading your settings…</p>
      ) : loadError ? (
        <p className="text-sm text-red-600">✕ Could not load settings: {loadError}</p>
      ) : (
        <div className="max-w-lg space-y-6 rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
          <div>
            <label className="mb-1 block text-sm font-medium text-stone-700">Telegram Chat ID</label>
            <div className="flex flex-wrap gap-3">
              <input
                value={prefs.telegram_chat_id}
                onChange={(e) => setPrefs((p) => ({ ...p, telegram_chat_id: e.target.value }))}
                placeholder="e.g. 123456789"
                className="w-52 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 placeholder-stone-400 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
              />
              <button
                type="button"
                onClick={sendTest}
                disabled={testing || !prefs.telegram_chat_id.trim()}
                className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs font-medium text-stone-700 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-400"
              >
                {testing ? "Sending…" : "Send test message"}
              </button>
            </div>
            {testResult === "ok" && <p className="mt-1 text-xs text-green-600">✓ Test message sent.</p>}
            {testResult === "error" && <p className="mt-1 text-xs text-red-600">✕ {testError}</p>}
          </div>

          <div className="space-y-3">
            <Toggle
              checked={prefs.notify_on_copy}
              onChange={(v) => setPrefs((p) => ({ ...p, notify_on_copy: v }))}
              label="Notify on copy trades"
            />
            <Toggle
              checked={prefs.notify_on_stop_loss}
              onChange={(v) => setPrefs((p) => ({ ...p, notify_on_stop_loss: v }))}
              label="Notify on stop-loss trigger"
            />
            <Toggle
              checked={prefs.notify_on_referral}
              onChange={(v) => setPrefs((p) => ({ ...p, notify_on_referral: v }))}
              label="Notify on referral earnings"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-stone-700">
              Minimum trade size to notify (raw USDso units)
            </label>
            <input
              value={prefs.min_trade_size}
              onChange={(e) => setPrefs((p) => ({ ...p, min_trade_size: e.target.value }))}
              className="w-40 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-400"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            {saveResult === "ok" && <span className="text-xs text-green-600">✓ Saved</span>}
            {saveResult === "error" && <span className="text-xs text-red-600">✕ {saveError}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
