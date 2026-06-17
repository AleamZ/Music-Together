import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Cormorant_Garamond, EB_Garamond, Playfair_Display } from "next/font/google";
import "./globals.css";
import Providers from "./Providers";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

// All three are VARIABLE fonts -> no `weight` option.
const cormorant = Cormorant_Garamond({ variable: "--font-cormorant", subsets: ["latin"], display: "swap" });
const ebGaramond = EB_Garamond({ variable: "--font-eb-garamond", subsets: ["latin"], display: "swap" });
const playfair = Playfair_Display({ variable: "--font-playfair", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "Music Together — Phòng nghe nhạc",
  description: "Cùng nhau chọn và nghe nhạc YouTube trong một phòng nghe cổ điển.",
  icons: { icon: "/logo.png", shortcut: "/logo.png", apple: "/logo.png" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="vi"
      className={`${geistSans.variable} ${geistMono.variable} ${cormorant.variable} ${ebGaramond.variable} ${playfair.variable} h-full antialiased`}
    >
      <body className="min-h-full"><Providers>{children}</Providers></body>
    </html>
  );
}
