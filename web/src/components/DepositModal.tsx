"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatUnits, parseUnits } from "viem";
import { useAccount, useConfig, useReadContract, useWriteContract } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import {
  COLLATERAL_TOKEN_ADDRESS,
  COPY_VAULT_ADDRESS,
  TRADER_REGISTRY_ADDRESS,
  copyVaultAbi,
  erc20Abi,
  traderRegistryAbi,
} from "@/lib/contracts";
import { getStoredReferrer } from "@/lib/referral";

type StepKey = "approve" | "follow" | "deposit";
type StepStatus = "pending" | "active" | "confirming" | "done" | "skipped" | "error";

interface DepositModalProps {
  traderId: bigint;
  traderLabel: string;
  isOpen: boolean;
  onClose: () => void;
  /// Pre-fills the amount field (e.g. "Convert to Real" from a simulation
  /// carrying over its virtual_deposit size) — the user can still edit it
  /// before confirming; this never auto-submits.
  initialAmount?: string;
}

const EXPLORER_TX_BASE = "https://shannon-explorer.somnia.network/tx";

const STEP_LABELS: Record<StepKey, string> = {
  approve: "Approve USDso → CopyVault",
  follow: "Follow trader (TraderRegistry)",
  deposit: "Deposit into CopyVault",
};

function StatusIcon({ status }: { status: StepStatus }) {
  switch (status) {
    case "done":
      return <span className="text-green-600">✓</span>;
    case "skipped":
      return <span className="text-stone-400">–</span>;
    case "confirming":
      return <span className="animate-pulse text-violet-600">◐</span>;
    case "active":
      return <span className="text-violet-600">●</span>;
    case "error":
      return <span className="text-red-600">✕</span>;
    default:
      return <span className="text-stone-300">○</span>;
  }
}

export function DepositModal({ traderId, traderLabel, isOpen, onClose, initialAmount }: DepositModalProps) {
  const router = useRouter();
  const wagmiConfig = useConfig();
  const { address } = useAccount();

  const vault = COPY_VAULT_ADDRESS as `0x${string}`;
  const registry = TRADER_REGISTRY_ADDRESS as `0x${string}`;
  const token = COLLATERAL_TOKEN_ADDRESS as `0x${string}`;

  const [amountInput, setAmountInput] = useState("");
  const [phase, setPhase] = useState<"input" | "running" | "success">("input");
  const [stepStatus, setStepStatus] = useState<Record<StepKey, StepStatus>>({
    approve: "pending",
    follow: "pending",
    deposit: "pending",
  });
  const [txHashes, setTxHashes] = useState<Partial<Record<StepKey, `0x${string}`>>>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [redirectSeconds, setRedirectSeconds] = useState(2);

  const { data: symbol } = useReadContract({
    address: token || undefined,
    abi: erc20Abi,
    functionName: "symbol",
    query: { enabled: isOpen && Boolean(token) },
  });
  const { data: decimals } = useReadContract({
    address: token || undefined,
    abi: erc20Abi,
    functionName: "decimals",
    query: { enabled: isOpen && Boolean(token) },
  });
  const { data: balance, refetch: refetchBalance } = useReadContract({
    address: token || undefined,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: isOpen && Boolean(address) && Boolean(token) },
  });
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: token || undefined,
    abi: erc20Abi,
    functionName: "allowance",
    args: address ? [address, vault] : undefined,
    query: { enabled: isOpen && Boolean(address) && Boolean(token) },
  });
  const { data: isFollowing, refetch: refetchFollowing } = useReadContract({
    address: registry,
    abi: traderRegistryAbi,
    functionName: "isFollowing",
    args: address ? [traderId, address] : undefined,
    query: { enabled: isOpen && Boolean(address) },
  });
  const { refetch: refetchNav } = useReadContract({
    address: vault,
    abi: copyVaultAbi,
    functionName: "poolNav",
    args: [traderId],
    query: { enabled: false },
  });

  const amountRaw = useMemo(() => {
    if (!amountInput.trim() || decimals === undefined) return undefined;
    try {
      const v = parseUnits(amountInput.trim(), decimals);
      return v > 0n ? v : undefined;
    } catch {
      return undefined;
    }
  }, [amountInput, decimals]);

  const insufficientBalance = amountRaw !== undefined && balance !== undefined && amountRaw > balance;

  const { writeContractAsync } = useWriteContract();

  // Fresh state every time the modal opens for a (possibly different) trader.
  useEffect(() => {
    if (isOpen) {
      setPhase("input");
      setStepStatus({ approve: "pending", follow: "pending", deposit: "pending" });
      setTxHashes({});
      setErrorMessage(null);
      setAmountInput(initialAmount ?? "");
      setRedirectSeconds(2);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, traderId]);

  // Drives the mobile bottom-sheet slide-up: starts translated off-screen,
  // flips true a tick after mount so the transition actually animates
  // (has no visible effect on desktop, where translate-y is overridden).
  const [sheetOpen, setSheetOpen] = useState(false);
  useEffect(() => {
    if (!isOpen) {
      setSheetOpen(false);
      return;
    }
    const t = requestAnimationFrame(() => setSheetOpen(true));
    return () => cancelAnimationFrame(t);
  }, [isOpen]);

  // Countdown + redirect after a successful deposit.
  useEffect(() => {
    if (phase !== "success") return;
    if (redirectSeconds <= 0) {
      router.push("/portfolio");
      return;
    }
    const t = setTimeout(() => setRedirectSeconds((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, redirectSeconds, router]);

  if (!isOpen) return null;

  const setStatus = (key: StepKey, status: StepStatus) => setStepStatus((s) => ({ ...s, [key]: status }));

  const runSequence = async () => {
    if (!address || amountRaw === undefined) return;
    setPhase("running");
    setErrorMessage(null);

    // Explicit, generous gas ceiling for every write below — Somnia
    // testnet's eth_estimateGas undershoots real cost, and leaving gas
    // unset lets viem fall back to a balance-derived default that this
    // RPC rejects outright with "rpc execution gas limit exceeded".
    const gasLimit = 3_000_000n;

    try {
      // ── Step 1: approve ────────────────────────────────────────────────
      if ((allowance ?? 0n) >= amountRaw) {
        setStatus("approve", "skipped");
      } else {
        setStatus("approve", "active");
        const hash = await writeContractAsync({
          address: token,
          abi: erc20Abi,
          functionName: "approve",
          args: [vault, amountRaw],
          gas: gasLimit,
        });
        setTxHashes((h) => ({ ...h, approve: hash }));
        setStatus("approve", "confirming");
        await waitForTransactionReceipt(wagmiConfig, { hash });
        setStatus("approve", "done");
        void refetchAllowance();
      }

      // ── Step 2: follow ─────────────────────────────────────────────────
      // NOTE: this runs BEFORE deposit, not after. CopyVault.deposit()
      // reverts with NotFollowingTrader() unless the caller already follows
      // traderId (see contracts/src/CopyVault.sol) — running deposit before
      // follow, as originally specified, would fail every single time.
      if (isFollowing) {
        setStatus("follow", "skipped");
      } else {
        setStatus("follow", "active");
        const hash = await writeContractAsync({
          address: registry,
          abi: traderRegistryAbi,
          functionName: "follow",
          args: [traderId],
          gas: gasLimit,
        });
        setTxHashes((h) => ({ ...h, follow: hash }));
        setStatus("follow", "confirming");
        await waitForTransactionReceipt(wagmiConfig, { hash });
        setStatus("follow", "done");
        void refetchFollowing();
      }

      // ── Step 3: deposit ────────────────────────────────────────────────
      // Uses depositWithReferral whenever a referrer is stored (see
      // ReferralBanner/getStoredReferrer) — it behaves exactly like a plain
      // deposit (no fee) unless this also happens to be the caller's
      // first-ever deposit, per CopyVault.depositWithReferral.
      setStatus("deposit", "active");
      const referrer = getStoredReferrer();
      const hash = referrer
        ? await writeContractAsync({
            address: vault,
            abi: copyVaultAbi,
            functionName: "depositWithReferral",
            args: [traderId, amountRaw, referrer],
            gas: gasLimit,
          })
        : await writeContractAsync({
            address: vault,
            abi: copyVaultAbi,
            functionName: "deposit",
            args: [traderId, amountRaw],
            gas: gasLimit,
          });
      setTxHashes((h) => ({ ...h, deposit: hash }));
      setStatus("deposit", "confirming");
      await waitForTransactionReceipt(wagmiConfig, { hash });
      setStatus("deposit", "done");

      void refetchBalance();
      void refetchNav();
      setPhase("success");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setErrorMessage(message);
      setStepStatus((s) => {
        const next = { ...s };
        (Object.keys(next) as StepKey[]).forEach((k) => {
          if (next[k] === "active" || next[k] === "confirming") next[k] = "error";
        });
        return next;
      });
      // Deliberately does not proceed to the next step — an approve failure
      // must not be followed by a deposit attempt, per spec.
    }
  };

  const setMax = () => {
    if (balance === undefined || decimals === undefined) return;
    setAmountInput(formatUnits(balance, decimals));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm md:items-center md:px-4"
      onClick={onClose}
    >
      {/* Mobile: full-width bottom sheet, slides up. Desktop (md+): centered 480px-ish modal. */}
      <div
        className="w-full max-w-md rounded-t-2xl border border-stone-200 border-b-0 bg-white p-6 shadow-xl transition-transform duration-200 ease-out md:translate-y-0 md:rounded-2xl md:border-b"
        style={{ transform: sheetOpen ? "translateY(0)" : "translateY(100%)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-stone-900">Follow &amp; deposit</h2>
            <p className="mt-0.5 text-sm text-stone-500">{traderLabel}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center text-stone-400 hover:text-stone-700"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {phase === "input" && (
          <div className="space-y-4">
            <div className="text-xs text-stone-500">
              Balance:{" "}
              {balance !== undefined && decimals !== undefined ? (
                <span className="text-stone-700">
                  {formatUnits(balance, decimals)} {symbol ?? ""}
                </span>
              ) : (
                "…"
              )}
            </div>

            {balance === 0n && (
              <p className="rounded-lg border border-blue-200 bg-blue-100 px-3 py-2 text-xs text-blue-600">
                You need {symbol ?? "the collateral token"} specifically — a generic testnet faucet token like
                tUSDC is a different asset and won&apos;t work here. Get {symbol ?? "it"} from DreamDEX&apos;s own
                faucet, not a general Somnia one.
              </p>
            )}

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-stone-700">
                Amount {symbol ? `(${symbol})` : ""}
              </span>
              <div className="flex gap-2">
                <input
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                  placeholder="100"
                  className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 placeholder-stone-400 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
                />
                <button
                  type="button"
                  onClick={setMax}
                  disabled={balance === undefined}
                  className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs text-stone-600 hover:bg-stone-50 disabled:cursor-not-allowed disabled:text-stone-400"
                >
                  Max
                </button>
              </div>
              {insufficientBalance && (
                <span className="mt-1 block text-xs text-red-600">✕ Amount exceeds your balance.</span>
              )}
            </label>

            <button
              type="button"
              onClick={runSequence}
              disabled={!address || amountRaw === undefined || insufficientBalance}
              className="w-full rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-400"
            >
              Follow + Deposit
            </button>
          </div>
        )}

        {(phase === "running" || phase === "success") && (
          <div className="space-y-4">
            <ol className="space-y-3">
              {(Object.keys(STEP_LABELS) as StepKey[]).map((key) => (
                <li key={key} className="flex items-start gap-3 text-sm">
                  <span className="mt-0.5 w-4 text-center">
                    <StatusIcon status={stepStatus[key]} />
                  </span>
                  <div className="flex-1">
                    <div className="text-stone-700">{STEP_LABELS[key]}</div>
                    {stepStatus[key] === "skipped" && (
                      <div className="text-xs text-stone-400">Already satisfied — skipped.</div>
                    )}
                    {txHashes[key] && (
                      <a
                        href={`${EXPLORER_TX_BASE}/${txHashes[key]}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-violet-700 hover:underline"
                      >
                        {txHashes[key]!.slice(0, 10)}… ↗
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ol>

            {errorMessage && (
              <div className="rounded-lg border border-red-200 bg-red-100 p-3 text-xs text-red-700">
                {errorMessage.slice(0, 220)}
              </div>
            )}

            {phase === "success" && (
              <div className="rounded-lg border border-green-200 bg-green-100 p-3 text-sm text-green-700">
                Deposited successfully. Redirecting to your portfolio in {redirectSeconds}s…{" "}
                <button
                  type="button"
                  onClick={() => router.push("/portfolio")}
                  className="underline hover:no-underline"
                >
                  Go now
                </button>
              </div>
            )}

            {errorMessage && (
              <button
                type="button"
                onClick={() => setPhase("input")}
                className="w-full rounded-lg border border-stone-200 bg-white px-4 py-2 text-sm text-stone-700 hover:bg-stone-50"
              >
                Back
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
