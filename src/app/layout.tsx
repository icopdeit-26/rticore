import type { Metadata } from 'next';
import './globals.css';
import { AppShell } from '@/components/layout/AppShell';

// Read deployment runtime at request time; do not bake a permissive shell into static HTML.
export const dynamic='force-dynamic';

export const metadata: Metadata = {
  title: 'RTICORE — RTI Business Management Platform',
  description: 'Integrated CRM, Tender Intelligence, Scoping Assessment, Dynamic Pricing, DoA Approval, Proposal Generation & Project Delivery.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id">
      <body className="antialiased font-sans">
        <AppShell nativeBusiness={process.env.RTICORE_RUNTIME==='hostinger'&&process.env.RTICORE_AUTH_MODE==='business'}>{children}</AppShell>
      </body>
    </html>
  );
}
