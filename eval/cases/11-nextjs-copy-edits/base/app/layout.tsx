import "./globals.css";

export const metadata = { title: "Loomly — patterns your whole team can find", description: "Loomly keeps every knitting pattern your studio owns in one searchable place." };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
