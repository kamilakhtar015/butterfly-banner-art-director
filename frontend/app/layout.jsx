import "./globals.css";

export const metadata = {
  title: "ButterFly — Banner Art Director",
  description: "Local AI art director for marketing banners",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300..800&display=swap" />
      </head>
      <body>{children}</body>
    </html>
  );
}
