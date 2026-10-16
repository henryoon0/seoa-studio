import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Sidebar } from "@/components/sidebar";
import { Toaster } from "@/components/toast";

const dashboardSans = localFont({
  src: [{ path: "./fonts/InterVariable.woff2", weight: "100 900", style: "normal" }],
  variable: "--font-geist-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "심플리홈 스튜디오",
  description: "서아님 소통·회의 작업대",
  other: { "supported-color-schemes": "light" },
};

export const viewport: Viewport = { colorScheme: "only light" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" className={`h-full antialiased light ${dashboardSans.variable}`} style={{ colorScheme: "light" }}>
      <body className="h-full flex font-sans bg-[#fafafa] text-neutral-900">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
        <Toaster />
      </body>
    </html>
  );
}
