"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function DeleteLeadButton({ id }: { id: number }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const onClick = async () => {
    if (!confirming) {
      setConfirming(true);
      setTimeout(() => setConfirming(false), 4000);
      return;
    }
    try {
      const res = await fetch(`/api/leads/${id}`, { method: "DELETE" });
      if (!res.ok) {
        alert("Could not delete that lead.");
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      alert("Could not delete that lead.");
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="text-[10px] uppercase tracking-[0.25em] text-[color:var(--sn-muted-stone)] hover:text-[color:var(--sn-amber)] transition-colors disabled:opacity-50"
    >
      {pending ? "Removing…" : confirming ? "Tap again to confirm" : "Remove"}
    </button>
  );
}
