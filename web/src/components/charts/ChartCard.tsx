"use client";

import type { ReactNode } from "react";

export function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
      <h3 className="text-lg font-semibold text-stone-900">{title}</h3>
      <div className="mt-4">{children}</div>
    </div>
  );
}

export function ChartSkeleton() {
  return (
    <div className="flex h-56 items-center justify-center">
      <div className="h-40 w-full animate-pulse rounded-md bg-stone-100" />
    </div>
  );
}

export function ChartEmptyState({ message }: { message: string }) {
  return (
    <div className="flex h-56 items-center justify-center">
      <p className="text-sm text-stone-500">{message}</p>
    </div>
  );
}
