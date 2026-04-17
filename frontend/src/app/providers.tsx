"use client";

import React from "react";
import dynamic from "next/dynamic";
import { AuthProvider } from "../contexts/AuthContext";

import "@rainbow-me/rainbowkit/styles.css";

const WalletProviders = dynamic(() => import("./walletProviders"), {
  ssr: false,
  loading: () => null,
});

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <WalletProviders>{children}</WalletProviders>
    </AuthProvider>
  );
}
