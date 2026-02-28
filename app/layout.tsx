import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Agentic Architecture Demo',
  description: 'Live demo of a supervisor + researcher + synthesizer agent pipeline using Claude',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className="dark">
      <body className="bg-gray-950 text-gray-100 min-h-screen antialiased">{children}</body>
    </html>
  );
}
