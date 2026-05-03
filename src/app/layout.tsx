import type { Metadata, Viewport } from "next";
import { Sora, Geist_Mono } from "next/font/google";
import "./globals.css";

const sora = Sora({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ReserveNI - Booking Management for Every Business in Northern Ireland",
  description:
    "Manage bookings, reduce no-shows, collect deposits, and automate client communications. Built for restaurants, salons, studios, and every bookable business in Northern Ireland.",
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
        className={`${sora.variable} ${geistMono.variable} font-sans antialiased bg-white text-slate-900`}
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
