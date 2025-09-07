import "./globals.css";

export const metadata = {
  title: "TV Clone Crypto",
  description: "MEXC & Binance scanner",
  icons: { icon: "/vercel.svg" } // safe default icon
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-zinc-950 text-zinc-100">{children}</body>
    </html>
  );
}
