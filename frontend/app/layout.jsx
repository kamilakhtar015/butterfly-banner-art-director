import "./globals.css";

export const metadata = {
  title: "ButterFly — Banner Art Director",
  description: "Local AI art director for marketing banners",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
