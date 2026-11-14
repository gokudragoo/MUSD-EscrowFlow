"use client";

import { useState, type ReactNode } from "react";
import { WagmiProvider, cookieToInitialState } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { wagmiConfig } from "@/config/wagmi";
import { TooltipProvider } from "@/components/ui/overlays";

export function Providers({ children, cookie }: { children: ReactNode; cookie?: string | null }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 10_000, refetchOnWindowFocus: true, retry: 1 } },
      }),
  );
  const initialState = cookieToInitialState(wagmiConfig, cookie ?? undefined);
  return (
    <WagmiProvider config={wagmiConfig} initialState={initialState}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          {children}
          <Toaster
            theme="dark"
            position="bottom-right"
            toastOptions={{
              classNames: {
                toast: "!bg-ink-800 !border !border-ink-600 !text-mist-100 !rounded-[12px]",
                description: "!text-mist-300",
                actionButton: "!bg-signal-500 !text-ink-950",
              },
            }}
          />
        </TooltipProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
