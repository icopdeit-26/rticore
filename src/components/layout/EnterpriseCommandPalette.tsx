'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Search, X, ArrowRight } from 'lucide-react';
import { navigationForRole } from '@/lib/enterprise-navigation';

type PaletteEntry = {
  readonly label: string;
  readonly href: string;
  readonly group: string;
  readonly keywords: string;
  readonly roles: readonly string[];
};

const V4_ENTERPRISE_DESTINATIONS: readonly PaletteEntry[] = [
  {
    label: 'Executive Command Center (M01)',
    href: '/erp/executive-command',
    group: 'V4 Enterprise ERP',
    keywords: 'm01 executive command bi ebitda revenue pipeline risk kpi',
    roles: ['admin', 'finance', 'approver'],
  },
  {
    label: 'RTI Finance Enterprise Suite F01–F25 (M21–M26)',
    href: '/finance',
    group: 'V4 Enterprise ERP',
    keywords: 'finance gl ar ap treasury psak 115 budget tax payroll asset icofr f01 f25',
    roles: ['admin', 'finance', 'approver'],
  },
  {
    label: 'Service Catalog V4 & 19-Role Rate Cards (M05)',
    href: '/erp/service-catalog',
    group: 'V4 Enterprise ERP',
    keywords: 'm05 service catalog mandays activity phases complexity rate card',
    roles: ['admin', 'finance', 'approver', 'sales', 'presales', 'project_manager', 'legal'],
  },
  {
    label: 'Interactive Service Pricing Simulator (M06)',
    href: '/erp/pricing-simulator',
    group: 'V4 Enterprise ERP',
    keywords: 'm06 pricing simulator margin break-even discount quotation snapshot',
    roles: ['admin', 'finance', 'approver', 'sales', 'presales', 'project_manager'],
  },
  {
    label: 'FlexGuard Enterprise Console (M09)',
    href: '/erp/flexguard-enterprise',
    group: 'V4 Enterprise ERP',
    keywords: 'm09 flexguard credits packages conversion matrix ledger sla workflow',
    roles: ['admin', 'finance', 'approver', 'sales', 'presales', 'project_manager', 'offense_lead', 'defense_leader', 'governance_leader'],
  },
  {
    label: 'FlexGuard Customer Portal (M09)',
    href: '/portal/flexguard',
    group: 'V4 Enterprise ERP',
    keywords: 'flexguard customer portal balance utilization statement acceptance',
    roles: ['admin', 'finance', 'approver', 'sales', 'presales', 'project_manager', 'viewer'],
  },
  {
    label: 'CTI, GRC Consulting & Enterprise Risk Register (M14/M15/M27)',
    href: '/erp/cyber-grc-cti',
    group: 'V4 Enterprise ERP',
    keywords: 'm14 m15 m27 cti ioc grc iso 27001 pdp risk register rcsa controls sod',
    roles: ['admin', 'approver', 'presales', 'project_manager', 'governance_leader', 'governance_member', 'defense_leader', 'defense_member', 'offense_lead', 'finance', 'legal'],
  },
  {
    label: 'Operations Center, Durable Jobs, DR Drills & Audit Explorer (M30)',
    href: '/erp/operations-center',
    group: 'V4 Enterprise ERP',
    keywords: 'm30 operations jobs dlq backup restore dr drill feature flags audit log',
    roles: ['admin', 'approver', 'finance', 'itdev_leader'],
  },
];

interface EnterpriseCommandPaletteProps {
  role: string | null;
}

export const EnterpriseCommandPalette: React.FC<EnterpriseCommandPaletteProps> = ({ role }) => {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const items = useMemo(() => {
    if (!role) return [];
    const v4 = V4_ENTERPRISE_DESTINATIONS.filter(item => item.roles.includes(role));
    const seen = new Set(v4.map(x => x.href));
    const canonical = navigationForRole(role).flatMap(g =>
      g.items
        .filter(it => !seen.has(it.href))
        .map(it => ({
          label: it.label,
          href: it.href,
          group: g.label,
          keywords: `${it.label} ${g.label} ${it.href}`.toLowerCase(),
          roles: it.roles,
        })),
    );
    return [...v4, ...canonical];
  }, [role]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items.slice(0, 16);
    return items
      .filter(i => i.label.toLowerCase().includes(q) || i.group.toLowerCase().includes(q) || i.keywords.includes(q) || i.href.toLowerCase().includes(q))
      .slice(0, 16);
  }, [items, query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query, open]);

  useEffect(() => {
    if (!role) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(prev => !prev);
      } else if (open && e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [role, open]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 20);
    else setQuery('');
  }, [open]);

  if (!role) return null;

  const navigate = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Buka pencarian global & command palette RTICORE (Ctrl+K)"
        title="Global Search & Command Palette (Ctrl+K)"
        className="flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs font-semibold text-slate-700 transition hover:border-[#2B124C] hover:bg-purple-50 hover:text-[#2B124C]"
      >
        <Search className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="hidden md:inline">Cari Modul…</span>
        <kbd className="hidden rounded border border-slate-300 bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-500 lg:inline">Ctrl K</kbd>
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-[220] flex items-start justify-center bg-black/50 p-4 pt-16 backdrop-blur-xs"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="RTICORE Global Command Palette"
            onClick={e => e.stopPropagation()}
            className="w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
          >
            <div className="flex items-center gap-2 border-b bg-[#2B124C] px-4 py-3 text-white">
              <Search className="h-4 w-4 text-[#C0C0C0]" aria-hidden="true" />
              <input
                ref={inputRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setSelectedIndex(i => Math.min(filtered.length - 1, i + 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setSelectedIndex(i => Math.max(0, i - 1));
                  } else if (e.key === 'Enter' && filtered[selectedIndex]) {
                    e.preventDefault();
                    navigate(filtered[selectedIndex].href);
                  }
                }}
                placeholder="Cari modul ERP, Finance F01–F25, Pricing, FlexGuard, CTI/GRC..."
                className="w-full bg-transparent text-sm text-white placeholder:text-white/60 focus:outline-none"
              />
              <button type="button" onClick={() => setOpen(false)} aria-label="Tutup command palette" className="rounded p-1 hover:bg-white/10">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-80 overflow-y-auto p-2">
              {filtered.length === 0 ? (
                <p className="p-6 text-center text-xs text-slate-500">Tidak ada modul yang cocok dengan pencarian Anda untuk role saat ini.</p>
              ) : (
                filtered.map((item, idx) => (
                  <button
                    key={item.href}
                    type="button"
                    onClick={() => navigate(item.href)}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left transition ${idx === selectedIndex ? 'bg-[#2B124C] text-white' : 'text-slate-800 hover:bg-slate-100'}`}
                  >
                    <div>
                      <p className="text-sm font-semibold">{item.label}</p>
                      <p className={`text-[11px] ${idx === selectedIndex ? 'text-[#C0C0C0]' : 'text-slate-500'}`}>{item.group} · {item.href}</p>
                    </div>
                    <ArrowRight className="h-4 w-4 shrink-0 opacity-75" aria-hidden="true" />
                  </button>
                ))
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
};
