import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Shopify Image Processor",
  description:
    "Rimozione sfondo e sfondo uniforme per foto prodotto e-commerce, da Google Drive o dal computer.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="it">
      <body>{children}</body>
    </html>
  );
}
