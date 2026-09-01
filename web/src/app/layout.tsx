import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { Header } from "@/components/Header";
import { ReferralBanner } from "@/components/ReferralBanner";
import { WhaleAlertBanner } from "@/components/WhaleAlertBanner";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "DreamCopy",
  description: "Non-custodial copy trading for DreamDEX on Somnia testnet.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${geistMono.variable} h-full antialiased`}>
      <body
        className="min-h-full flex flex-col bg-[#FAF6ED] text-stone-900"
        suppressHydrationWarning
      >
        <Providers>
          <WhaleAlertBanner />
          <Header />
          <main className="mx-auto w-full max-w-5xl flex-1 space-y-6 px-6 py-10">
            <ReferralBanner />
            {children}
          </main>
          <footer className="bg-black px-6 py-6 text-center text-xs text-stone-400">
            DreamCopy — non-custodial copy trading for DreamDEX on Somnia testnet (chain 50312).
          </footer>
        </Providers>
      </body>
    </html>
  );
}
