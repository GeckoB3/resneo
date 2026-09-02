import type { Metadata, Viewport } from "next";
import { Inter, Geist_Mono, Nunito, Nunito_Sans } from "next/font/google";
import "./globals.css";
import { AnalyticsGate } from "@/components/analytics/AnalyticsGate";
import { CookieConsentBanner } from "@/components/analytics/CookieConsentBanner";

const inter = Inter({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * Marketing type: a rounded display face for headings and its companion for
 * body copy. Only elements under the `home-warm` class (globals.css) use
 * them, so the dashboard, booking pages and help centre keep Inter.
 */
const marketingDisplay = Nunito({
  variable: "--font-home-display",
  subsets: ["latin"],
  weight: ["700", "800", "900"],
  display: "swap",
});

const marketingBody = Nunito_Sans({
  variable: "--font-home-body",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://www.resneo.com"),
  title: "ResNeo - Booking Management Software for Every Business",
  description:
    "Manage bookings, reduce no-shows, collect deposits, and automate client communications. Booking software for salons, studios, clinics, and every business that takes bookings.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: "#ffffff",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="light" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${geistMono.variable} ${marketingDisplay.variable} ${marketingBody.variable} font-sans antialiased bg-white text-slate-900`}
        suppressHydrationWarning
      >
        {children}
        <CookieConsentBanner />
        <AnalyticsGate />
      </body>
    </html>
  );
}
