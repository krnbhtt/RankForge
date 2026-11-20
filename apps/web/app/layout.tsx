import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'RankForge AI — Autonomous E-commerce Diagnostic & Optimization',
  description: 'Diagnose why any product page fails to rank and convert, and rebuild it section-by-section with live before/after scores.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 antialiased">
        {children}
      </body>
    </html>
  );
}
