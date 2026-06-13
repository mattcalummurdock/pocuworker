import type { Metadata } from "next";
import { DM_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { WalletProvider } from "../components/WalletProvider";
import { WalletGate } from "../components/WalletGate";
import { AppShell } from "../components/layout/AppShell";

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-dm-sans",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
});

export const metadata: Metadata = {
  title: "POCU — On-Chain ML Training",
  description: "POCU — Hedera agent kit + Kaggle on-chain ML training",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${dmSans.variable} ${jetbrainsMono.variable} font-sans antialiased`}>
        <WalletProvider>
          <WalletGate>
            <AppShell>{children}</AppShell>
          </WalletGate>
        </WalletProvider>
      </body>
    </html>
  );
}
