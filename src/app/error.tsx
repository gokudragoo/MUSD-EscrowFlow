"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-24 text-center">
      <h1 className="text-[26px] font-semibold text-white">This view failed to load</h1>
      <p className="mt-3 text-[15px] text-mist-300">
        No transaction was sent. Your funds and on-chain state are unaffected. Try again; if it keeps failing, the Mezo RPC may be busy.
      </p>
      {error.digest && <p className="mt-2 font-mono text-[12px] text-mist-500">Reference {error.digest}</p>}
      <div className="mt-8">
        <Button onClick={reset}>Try again</Button>
      </div>
    </div>
  );
}
