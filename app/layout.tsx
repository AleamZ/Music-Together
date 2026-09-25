import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Cormorant_Garamond, EB_Garamond, Playfair_Display, Pixelify_Sans, VT323 } from "next/font/google";
import "./globals.css";
import Providers from "./Providers";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

// All three are VARIABLE fonts -> no `weight` option.
const cormorant = Cormorant_Garamond({ variable: "--font-cormorant", subsets: ["latin"], display: "swap" });
const ebGaramond = EB_Garamond({ variable: "--font-eb-garamond", subsets: ["latin"], display: "swap" });
const playfair = Playfair_Display({ variable: "--font-playfair", subsets: ["latin"], display: "swap" });
const pixel = Pixelify_Sans({ variable: "--font-pixel", subsets: ["latin"], display: "swap" });
// Game mode (v13) HUD + canvas text. Static font → needs `weight`; has a Vietnamese subset. Only game mode uses it,
// so it is not preloaded on every route.
const vt323 = VT323({ weight: "400", variable: "--font-vt323", subsets: ["latin", "vietnamese"], display: "swap", preload: false });

export const metadata: Metadata = {
  title: "Music Together — Phòng nghe nhạc",
  description: "Cùng nhau chọn và nghe nhạc YouTube trong một phòng nghe cổ điển.",
  icons: { icon: "/logo.png", shortcut: "/logo.png", apple: "/logo.png" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="vi"
      className={`${geistSans.variable} ${geistMono.variable} ${cormorant.variable} ${ebGaramond.variable} ${playfair.variable} ${pixel.variable} ${vt323.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <script dangerouslySetInnerHTML={{ __html: "try{var t=localStorage.getItem('music-together:theme');if(t==='cozy'||t==='dragon')document.documentElement.setAttribute('data-theme',t)}catch(e){}" }} />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
