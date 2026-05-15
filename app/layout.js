export const metadata = {
  title: "Voyager's Hook Chat",
  description: "AI chat assistant for Voyager's Hook Fishing Tackle Company"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0, background: 'transparent', fontFamily: 'Outfit, sans-serif' }}>
        {children}
      </body>
    </html>
  );
}
