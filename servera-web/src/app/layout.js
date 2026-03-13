import "./globals.css";

export const metadata = {
  title: "Servera — SSH & Server Management for Windows",
  description:
    "Servera is the beautiful desktop app for managing your servers. Connect via SSH, monitor real-time metrics, and control your entire infrastructure from one place.",
  keywords: ["server management", "SSH client", "Windows", "terminal", "DevOps", "infrastructure"],
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
