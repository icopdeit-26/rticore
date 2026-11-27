'use client';

import { CamsFinanceInbox } from './CamsFinanceInbox';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Activity, AlertTriangle, ArrowLeftRight, Banknote, BookOpen, Briefcase,
  Building2, Calculator, CheckCircle2, ChevronRight, ClipboardList, Cpu,
  CreditCard, Database, Download, FileSpreadsheet, FileText, Filter,
  FolderKanban, Landmark, Layers, LayoutDashboard, Lock, RefreshCw,
  Scale, Search, ShieldAlert, ShieldCheck, Sparkles, TrendingUp, Users,
} from 'lucide-react';
import {
  RTI_FINANCE_BRAND,
  RTI_FINANCE_MENUS,
  RTI_FINANCE_ROLES,
  FINANCIAL_CLOSING_17_CHECKLIST,
  ICOFR_15_AUTOMATED_CONTROLS,
  RTICORE_DOCKING_EVENT_TYPES,
  type FinanceMenuId,
} from '@/lib/rti-finance-core';
import { FINANCE_REGISTERS, registerRows, registerCSV } from '@/lib/finance-registers';

function formatIDRFromCents(cents: number | null | undefined): string {
  const val = Number(cents || 0) / 100;
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(val);
}

interface RTIFinanceWorkstationProps {
  initialMenu?: FinanceMenuId;
}

export function RTIFinanceWorkstation({ initialMenu = 'F01' }: RTIFinanceWorkstationProps) {
  const [activeMenu, setActiveMenu] = useState<FinanceMenuId>(initialMenu);
  const requestRef = useRef<AbortController | null>(null);
  const actionRef = useRef(false);
  const [legalEntities, setLegalEntities] = useState<Array<{ id: string; code: string; label: string }>>([]);
  const [selectedEntity, setSelectedEntity] = useState<string>('');
  const [period, setPeriod] = useState<string>(new Date().toISOString().slice(0, 7));
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [dashboardPersona, setDashboardPersona] = useState<'ceo' | 'cfo' | 'pm' | 'ops'>('cfo');
  const [loading, setLoading] = useState<boolean>(true);
  const [busy, setBusy] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null);

  // Interactive Form States
  const [aiQueryText, setAiQueryText] = useState<string>('Apakah jurnal posted periode ini seimbang?');
  const [aiResult, setAiResult] = useState<Record<string, unknown> | null>(null);
  const [dockingMode, setDockingMode] = useState<'standalone' | 'docked' | 'multi_entity'>('docked');
  const [dockingEndpoint, setDockingEndpoint] = useState('');
  const [dockingSecret, setDockingSecret] = useState('');

  function invalidateScope() {
    requestRef.current?.abort();
    setPayload(null);
    setAiResult(null);
    setFeedback(null);
    setLoading(true);
  }

  const loadFinanceData = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setPayload(null);
    setAiResult(null);
    setLoading(true);
    try {
      const q = new URLSearchParams({ menu: activeMenu, period });
      if (selectedEntity) q.set('legal_entity_id', selectedEntity);

      const res = await fetch(`/api/finance?${q.toString()}`, {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
      });
      const json = await res.json();
      if (controller.signal.aborted) return;
      if (!res.ok || !json.success) {
        setFeedback({ kind: 'err', text: json.message || 'Gagal memuat data RTI Finance' });
      } else {
        if (json.menu !== activeMenu || json.period !== period || (selectedEntity && json.legalEntityId !== selectedEntity)) {
          setFeedback({ kind: 'err', text: 'Respons Finance tidak sesuai konteks permintaan' });
          return;
        }
        setLegalEntities(Array.isArray(json.legalEntities) ? json.legalEntities : []);
        if (!selectedEntity && json.legalEntityId) {
          setSelectedEntity(json.legalEntityId);
          return;
        }
        setPayload(json);
      }
    } catch {
      if (!controller.signal.aborted) setFeedback({ kind: 'err', text: 'Tidak dapat menghubungi endpoint /api/finance' });
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [activeMenu, period, selectedEntity]);

  useEffect(() => {
    void loadFinanceData();
    return () => requestRef.current?.abort();
  }, [loadFinanceData]);

  const currentMenuDef = useMemo(
    () => RTI_FINANCE_MENUS.find(m => m.id === activeMenu) || RTI_FINANCE_MENUS[0],
    [activeMenu],
  );

  const filteredMenus = useMemo(() => {
    const term = searchQuery.trim().toLowerCase();
    return RTI_FINANCE_MENUS.filter(
      m =>
        !term ||
        m.id.toLowerCase().includes(term) ||
        m.title.toLowerCase().includes(term) ||
        m.primaryFunction.toLowerCase().includes(term),
    );
  }, [searchQuery]);

  const identity = (payload?.identity as Record<string, unknown>) || {};
  const kpis = (payload?.kpis as Record<string, number | boolean>) || {};
  const data = (payload?.data as Record<string, Array<Record<string, unknown>>>) || {};
  const registers = FINANCE_REGISTERS[activeMenu].map(key => ({ key, rows: registerRows(data[key] || []) }));
  const authorizedMenus = Array.isArray(identity.allowedMenus) ? identity.allowedMenus as string[] : null;
  const visibleMenus = filteredMenus.filter(m => !authorizedMenus || authorizedMenus.includes(m.id));

  async function executeFinanceAction(body: Record<string, unknown>, successMsg: string) {
    if (actionRef.current || !payload || !selectedEntity || loading) return;
    actionRef.current = true;
    setBusy(true);
    setFeedback(null);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const res = await fetch('/api/finance', {
        method: 'POST',
        credentials: 'same-origin',
        headers,
        body: JSON.stringify({ ...body, legal_entity_id: selectedEntity }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setFeedback({ kind: 'err', text: json.message || 'Transaksi ditolak oleh kontrol keuangan' });
      } else {
        setFeedback({ kind: 'ok', text: successMsg });
        if (body.action === 'ai_financial_query' && json.insight) {
          setAiResult(json.insight);
        } else {
          await loadFinanceData();
        }
      }
    } catch {
      setFeedback({ kind: 'err', text: 'Kesalahan jaringan saat memproses transaksi keuangan' });
    } finally {
      actionRef.current = false;
      setBusy(false);
    }
  }

  function exportCurrentRegisterCSV() {
    if (!payload || loading || busy) return;
    const rows = registers.flatMap(register => register.rows.map(row => ({ ...row, reference: register.key + ': ' + row.reference })));
    const blob = new Blob([registerCSV(rows)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `RTI_FINANCE_${activeMenu}_${period}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-screen bg-[#F4F5F7] text-[#050505]">
      {/* Top Enterprise Header Bar — Primary #2B124C & Dark #050505 */}
      <header
        style={{ background: 'linear-gradient(135deg, #050505 0%, #2B124C 65%, #1b0b30 100%)' }}
        className="border-b border-[#C0C0C0]/25 px-4 py-4 text-white shadow-md sm:px-6"
      >
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#C0C0C0]/40 bg-white/10 font-black tracking-tighter text-[#C0C0C0]">
              RTI
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="rounded bg-[#C0C0C0]/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-[#C0C0C0]">
                  {RTI_FINANCE_BRAND.name} V1.0
                </span>
                <span className="rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-200">
                  Finance · {payload ? 'API verified' : 'Unverified'}
                </span>
              </div>
              <h1 className="mt-0.5 text-lg font-extrabold tracking-tight sm:text-xl">
                {RTI_FINANCE_BRAND.subtitle}
              </h1>
            </div>
          </div>

          {/* Application Switcher & Context Selectors */}
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/sales/executive"
              className="inline-flex items-center gap-1.5 rounded-xl border border-[#C0C0C0]/30 bg-white/10 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/20"
            >
              <ArrowLeftRight className="h-3.5 w-3.5 text-[#C0C0C0]" />
              RTICore ERP/PSA Switcher
            </Link>

            <select
              aria-label="Pilih Legal Entity"
              value={selectedEntity}
              disabled={busy}
              onChange={e => { invalidateScope(); setSelectedEntity(e.target.value); }}
              className="h-9 rounded-xl border border-[#C0C0C0]/30 bg-[#050505]/70 px-3 text-xs font-semibold text-white outline-none"
            >
              {legalEntities.length === 0 ? (
                <option value="">Legal Entity Default</option>
              ) : (
                legalEntities.map(ent => (
                  <option key={ent.id} value={ent.id}>
                    {ent.code} — {ent.label}
                  </option>
                ))
              )}
            </select>

            <input
              type="month"
              aria-label="Periode Akuntansi"
              value={period}
              disabled={busy}
              onChange={e => { invalidateScope(); setPeriod(e.target.value); }}
              className="h-9 rounded-xl border border-[#C0C0C0]/30 bg-[#050505]/70 px-3 text-xs font-semibold text-white outline-none"
            />

            <span className="rounded-xl border border-[#C0C0C0]/40 px-3 py-2 text-xs">
              Role terverifikasi: {String(identity.financeRoleLabel || 'Belum terverifikasi')}
            </span>
          </div>
        </div>
      </header>

      {/* Main Enterprise Workstation Grid */}
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 px-4 py-6 lg:grid-cols-12 sm:px-6">
        {/* Left 25-Menu Navigation Rail (F01 - F25) */}
        <aside className="lg:col-span-3">
          <div className="sticky top-6 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="mb-3 flex items-center justify-between border-b border-slate-100 pb-2.5">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#2B124C]">
                  Enterprise Menu Structure
                </p>
                <h2 className="text-sm font-extrabold text-slate-900">25 Kelompok Menu (F01–F25)</h2>
              </div>
              <span className="rounded-lg bg-[#2B124C]/10 px-2 py-0.5 text-xs font-bold text-[#2B124C]">
                {visibleMenus.length}/25
              </span>
            </div>

            <div className="relative mb-3">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Cari F01–F25 (PSAK 115, GL, Tax…)"
                className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50 pl-8 pr-3 text-xs outline-none focus:border-[#2B124C] focus:bg-white"
              />
            </div>

            <nav aria-label="25 Menu RTI Finance" className="max-h-[68vh] space-y-1 overflow-y-auto pr-1">
              {visibleMenus.map(m => {
                const active = m.id === activeMenu;
                return (
                  <button
                    key={m.id}
                    type="button"
                    disabled={busy}
                    onClick={() => { if (m.id !== activeMenu) { invalidateScope(); setActiveMenu(m.id); } }}
                    className={[
                      'flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs transition',
                      active
                        ? 'bg-[#2B124C] font-bold text-white shadow-sm'
                        : 'font-medium text-slate-700 hover:bg-slate-100',
                    ].join(' ')}
                  >
                    <span className="truncate">
                      <span className={active ? 'mr-2 font-mono text-[#C0C0C0]' : 'mr-2 font-mono text-[#2B124C]'}>
                        {m.id}
                      </span>
                      {m.title}
                    </span>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-60" />
                  </button>
                );
              })}
            </nav>
          </div>
        </aside>

        {/* Right Primary Financial Workspace */}
        <section className="space-y-6 lg:col-span-9">
          {/* Breadcrumb & Active Menu Header */}
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
                <span>RTI Finance</span>
                <ChevronRight className="h-3.5 w-3.5" />
                <span>{currentMenuDef.category}</span>
                <ChevronRight className="h-3.5 w-3.5" />
                <span className="font-bold text-[#2B124C]">{currentMenuDef.id}</span>
              </div>
              <h2 className="mt-1 text-xl font-extrabold text-slate-900">
                {currentMenuDef.id} · {currentMenuDef.title}
              </h2>
              <p className="text-xs text-slate-600">{currentMenuDef.primaryFunction}</p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={busy || loading}
                onClick={() => void loadFinanceData()}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
              <button
                type="button"
                disabled={!payload || busy || loading || registers.length === 0}
                onClick={exportCurrentRegisterCSV}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                <Download className="h-3.5 w-3.5" />
                Export CSV
              </button>
              <button
                type="button"
                disabled={!payload || loading || busy}
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#2B124C] px-3 py-2 text-xs font-semibold text-white hover:bg-[#3c1a69]"
              >
                <FileText className="h-3.5 w-3.5" />
                Print / PDF Report
              </button>
            </div>
          </div>

          {feedback && (
            <div
              role="alert"
              className={[
                'flex items-center justify-between rounded-2xl border px-4 py-3 text-xs font-semibold',
                feedback.kind === 'ok'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                  : 'border-rose-200 bg-rose-50 text-rose-900',
              ].join(' ')}
            >
              <span>{feedback.text}</span>
              <button type="button" onClick={() => setFeedback(null)} className="underline">
                Tutup
              </button>
            </div>
          )}

          {!payload ? <div role="status" className="rounded-2xl bg-white p-5 text-sm text-slate-600">{loading ? 'Memuat data Finance terotorisasi…' : 'Data tidak tersedia atau akses ditolak. Tidak ada data transaksi yang ditampilkan.'}</div> : <>
          {/* Global Financial Integrity KPI Strip */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                GL Trial Balance Equilibrium
              </p>
              <p className="mt-1 text-lg font-extrabold text-slate-900">
                {kpis.trialBalanceDebitCents == null ? '—' : formatIDRFromCents(Number(kpis.trialBalanceDebitCents))}
              </p>
              <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {kpis.trialBalanceBalanced === true ? 'Debit = Kredit (Balanced)' : kpis.trialBalanceBalanced === false ? 'Unbalanced Exception' : 'Tidak tersedia / akses dibatasi'}
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                AR Outstanding (Order-to-Cash)
              </p>
              <p className="mt-1 text-lg font-extrabold text-slate-900">
                {kpis.arOutstandingCents == null ? '—' : formatIDRFromCents(Number(kpis.arOutstandingCents))}
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                Billed: {kpis.arBilledCents == null ? '—' : formatIDRFromCents(Number(kpis.arBilledCents))} · Collected:{' '}
                {kpis.arCollectedCents == null ? '—' : formatIDRFromCents(Number(kpis.arCollectedCents))}
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                AP Outstanding (Procure-to-Pay)
              </p>
              <p className="mt-1 text-lg font-extrabold text-slate-900">
                {kpis.apOutstandingCents == null ? '—' : formatIDRFromCents(Number(kpis.apOutstandingCents))}
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                3-Way Matched AP: {kpis.apApprovedCents == null ? '—' : formatIDRFromCents(Number(kpis.apApprovedCents))}
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                ICOFR & Docking Health
              </p>
              <p className="mt-1 text-lg font-extrabold text-[#2B124C]">
                {kpis.openExceptionsCount == null ? '—' : Number(kpis.openExceptionsCount)} Open Exceptions
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                DLQ / Failed Events: {kpis.failedEventsCount == null ? '—' : Number(kpis.failedEventsCount)} · Limit:{' '}
                {formatIDRFromCents(Number(identity.approvalLimitCents || 0))}
              </p>
            </div>
          </div>

          {/* =============================================================== */}
          {/* F01: EXECUTIVE FINANCE DASHBOARD (CEO, CFO, PM, FINANCE OPS)    */}
          {/* =============================================================== */}
          {activeMenu === 'F01' && (
            <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">
                    Role-Specific Executive Financial Views (Section 20)
                  </h3>
                  <p className="text-xs text-slate-500">
                    Pilih perspektif eksekutif untuk memonitor indikator sesuai tanggung jawab jabatan.
                  </p>
                </div>
                <div className="flex rounded-xl bg-slate-100 p-1">
                  {(
                    [
                      ['ceo', 'CEO Dashboard'],
                      ['cfo', 'CFO Dashboard'],
                      ['pm', 'Project Manager'],
                      ['ops', 'Finance Operations'],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setDashboardPersona(id)}
                      className={[
                        'rounded-lg px-3 py-1.5 text-xs font-bold transition',
                        dashboardPersona === id ? 'bg-[#2B124C] text-white shadow' : 'text-slate-600 hover:text-slate-900',
                      ].join(' ')}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {dashboardPersona === 'ceo' && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-bold text-slate-500">Total Recognized Revenue & Growth</p>
                    <p className="mt-1 text-xl font-extrabold text-slate-900">
                      {kpis.glRevenueCents == null ? '—' : formatIDRFromCents(Number(kpis.glRevenueCents))}
                    </p>
                    <p className="mt-1 text-xs text-slate-600">PSAK 115 Verified Contract Revenue</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-bold text-slate-500">Gross Profit, EBITDA & Net Profit</p>
                    <p className="mt-1 text-xl font-extrabold text-emerald-700">
                      {kpis.glNetIncomeCents == null ? '—' : formatIDRFromCents(Number(kpis.glNetIncomeCents))}
                    </p>
                    <p className="mt-1 text-xs text-slate-600">
                      Total Expenses: {kpis.glExpenseCents == null ? '—' : formatIDRFromCents(Number(kpis.glExpenseCents))}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-bold text-slate-500">Active Delivery Projects & Backlog</p>
                    <p className="mt-1 text-xl font-extrabold text-[#2B124C]">
                      {(data.projects || []).length} Active Projects
                    </p>
                    <p className="mt-1 text-xs text-slate-600">
                      PSAK 115 Obligations: {(data.obligations || []).length}
                    </p>
                  </div>
                </div>
              )}

              {dashboardPersona === 'cfo' && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-bold text-slate-500">Working Capital & Liquidity</p>
                    <p className="mt-1 text-xl font-extrabold text-slate-900">
                      {kpis.glAssetCents == null || kpis.glLiabilityCents == null ? '—' : formatIDRFromCents(Number(kpis.glAssetCents) - Number(kpis.glLiabilityCents))}
                    </p>
                    <p className="mt-1 text-xs text-slate-600">
                      13-Week Forecast Buckets: {(data.cashForecasts || []).length}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-bold text-slate-500">AR vs AP Aging Balance</p>
                    <p className="mt-1 text-xl font-extrabold text-slate-900">
                      {kpis.arOutstandingCents == null || kpis.apOutstandingCents == null ? '—' : formatIDRFromCents(Number(kpis.arOutstandingCents) - Number(kpis.apOutstandingCents))}
                    </p>
                    <p className="mt-1 text-xs text-slate-600">
                      Reconciliations: {(data.reconciliations || []).length} records
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-bold text-slate-500">Period Close & Tax Obligations</p>
                    <p className="mt-1 text-xl font-extrabold text-[#2B124C]">
                      {(data.taxTransactions || []).length} Tax Records
                    </p>
                    <p className="mt-1 text-xs text-slate-600">
                      Open ICOFR Exceptions: {kpis.openExceptionsCount == null ? '—' : Number(kpis.openExceptionsCount)}
                    </p>
                  </div>
                </div>
              )}

              {dashboardPersona === 'pm' && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-bold text-slate-500">Tracked Projects & Cost Entries</p>
                    <p className="mt-1 text-xl font-extrabold text-slate-900">
                      {(data.projects || []).length} Projects · {(data.projectCosts || []).length} Cost Rows
                    </p>
                    <p className="mt-1 text-xs text-slate-600">Anti-double-counting guard active</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-bold text-slate-500">Project Financial Snapshots</p>
                    <p className="mt-1 text-xl font-extrabold text-[#2B124C]">
                      {(data.projectSnapshots || []).length} Snapshots
                    </p>
                    <p className="mt-1 text-xs text-slate-600">Provisional until Period Hard Close</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-bold text-slate-500">Billing Milestones & Collection</p>
                    <p className="mt-1 text-xl font-extrabold text-emerald-700">
                      {(data.arInvoices || []).length} Invoices
                    </p>
                    <p className="mt-1 text-xs text-slate-600">Linked to accepted BAST milestones</p>
                  </div>
                </div>
              )}

              {dashboardPersona === 'ops' && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-bold text-slate-500">Unposted Journals</p>
                    <p className="mt-1 text-xl font-extrabold text-amber-700">
                      {(data.journals || []).filter(j => j.status !== 'posted').length}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-bold text-slate-500">Pending Invoices (AR/AP)</p>
                    <p className="mt-1 text-xl font-extrabold text-slate-900">
                      {(data.arInvoices || []).filter(i => i.status === 'draft').length +
                        (data.apInvoices || []).filter(i => i.status === 'draft').length}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-bold text-slate-500">Pending Bank Approvals</p>
                    <p className="mt-1 text-xl font-extrabold text-slate-900">
                      {(data.vendorBanks || []).filter(b => b.status === 'pending_approval').length}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-bold text-slate-500">Failed Docking Events</p>
                    <p className="mt-1 text-xl font-extrabold text-rose-700">
                      {kpis.failedEventsCount == null ? '—' : Number(kpis.failedEventsCount)}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* =============================================================== */}
          {/* F24: AI FINANCIAL INTELLIGENCE WORKSPACE                        */}
          {/* =============================================================== */}
          {activeMenu === 'F24' && (
            <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">
                    Finance Evidence Assistant — Read-Only Decision Support (Section 23)
                  </h3>
                  <p className="text-xs text-slate-600">
                    Ringkasan lokal berbasis jurnal posted pada scope terpilih; bukan proyeksi AI. Tidak dapat memposting jurnal, menyetujui pembayaran, atau menutup periode.
                  </p>
                </div>
                <span className="rounded-lg bg-[#2B124C]/10 px-2.5 py-1 text-[11px] font-bold text-[#2B124C]">
                  Read-Only Guard Active
                </span>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <input
                  type="text"
                  value={aiQueryText}
                  onChange={e => setAiQueryText(e.target.value)}
                  className="h-10 flex-1 rounded-xl border border-slate-200 px-3 text-xs outline-none focus:border-[#2B124C]"
                  placeholder="Masukkan pertanyaan untuk konteks review jurnal posted…"
                />
                <button
                  type="button"
                  disabled={busy || loading || !payload || !selectedEntity}
                  onClick={() =>
                    void executeFinanceAction(
                      { action: 'ai_financial_query', query: aiQueryText, period },
                      'Ringkasan bukti jurnal berhasil dimuat secara read-only',
                    )
                  }
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#2B124C] px-4 py-2 text-xs font-bold text-white hover:bg-[#3c1a69]"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Analisis Sekarang
                </button>
              </div>

              {aiResult && (
                <div className="rounded-xl border border-[#2B124C]/20 bg-[#2B124C]/5 p-4 text-xs">
                  <p className="font-extrabold text-[#2B124C]">{String(aiResult.headline || '')}</p>
                  <p className="mt-1 text-slate-700">{String(aiResult.explanation || '')}</p>
                  <p className="mt-2 font-bold text-slate-800">Sumber Data Tertelusur (Traceable Sources):</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {((aiResult.traceableSources as string[]) || []).map(src => (
                      <span key={src} className="rounded bg-white px-2 py-0.5 font-mono text-[11px] text-slate-700 shadow-sm">
                        {src}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* =============================================================== */}
          {/* F25: SYSTEM ADMINISTRATION & RTICORE DOCKING MANAGEMENT CENTER  */}
          {/* =============================================================== */}
          {activeMenu === 'F25' && (
            <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">
                    RTICore Finance Docking Management Center (Section 6)
                  </h3>
                  <p className="text-xs text-slate-600">
                    Kelola koneksi RTICore, mode operasi (Standalone / Docked / Multi-Entity), 22 kontrak event, dan DLQ.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input aria-label="Endpoint docking" value={dockingEndpoint} onChange={e=>setDockingEndpoint(e.target.value)} placeholder="Endpoint RTICore" className="h-9 rounded-xl border px-3 text-xs" />
                  <input aria-label="Webhook secret" type="password" autoComplete="new-password" value={dockingSecret} onChange={e=>setDockingSecret(e.target.value)} placeholder="Webhook secret (min. 32)" className="h-9 rounded-xl border px-3 text-xs" />
                  <select
                    value={dockingMode}
                    onChange={e => setDockingMode(e.target.value as 'standalone' | 'docked' | 'multi_entity')}
                    className="h-9 rounded-xl border border-slate-200 px-3 text-xs font-semibold"
                  >
                    <option value="standalone">Mode A — Standalone Finance</option>
                    <option value="docked">Mode B — RTICore Docked</option>
                    <option value="multi_entity">Mode C — Enterprise Multi-Entity</option>
                  </select>
                  <button
                    type="button"
                    disabled={busy || dockingSecret.length < 32 || dockingEndpoint.length < 5 || !['super_admin','cfo'].includes(String(identity.financeRole))}
                    onClick={() => {
                      const nextStatus = 'disconnected';
                      void executeFinanceAction(
                        {
                          action: 'configure_docking',
                          operating_mode: dockingMode,
                          connection_status: nextStatus,
                          rticore_endpoint: dockingEndpoint,
                          webhook_secret: dockingSecret,
                        },
                        'Konfigurasi docking tersimpan; konektivitas aktual belum diverifikasi.',
                      );
                      setDockingSecret('');
                    }}
                    className="rounded-xl bg-[#2B124C] px-3 py-2 text-xs font-bold text-white"
                  >
                    Simpan konfigurasi docking
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-200 p-4">
                  <h4 className="text-xs font-extrabold uppercase tracking-wider text-[#2B124C]">
                    22 Versioned Event Contracts Subscribed
                  </h4>
                  <div className="mt-2 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
                    {RTICORE_DOCKING_EVENT_TYPES.map(ev => (
                      <span
                        key={ev}
                        className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[11px] text-slate-700"
                      >
                        {ev}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 p-4">
                  <h4 className="text-xs font-extrabold uppercase tracking-wider text-[#2B124C]">
                    18 Granular Finance Roles Matrix (Section 22)
                  </h4>
                  <div className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs">
                    {RTI_FINANCE_ROLES.map(r => (
                      <div key={r.id} className="flex items-center justify-between border-b border-slate-100 py-1">
                        <span className="font-semibold text-slate-800">
                          {r.number}. {r.label}
                        </span>
                        <span className="font-mono text-[11px] text-slate-500">
                          Limit: {formatIDRFromCents(r.defaultLimitCents)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* =============================================================== */}
          {/* F20 & F23: CLOSING CHECKLIST (17 ITEMS) & ICOFR (15 CONTROLS)   */}
          {/* =============================================================== */}
          {(activeMenu === 'F20' || activeMenu === 'F23') && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-sm font-extrabold text-slate-900">
                  17-Point Period-End Closing Checklist (Section 18)
                </h3>
                <p className="mb-3 text-xs text-slate-500">
                  Lifecycle: Open → Soft Close → Under Review → Approved → Hard Close
                </p>
                <div className="max-h-64 space-y-1.5 overflow-y-auto text-xs">
                  {FINANCIAL_CLOSING_17_CHECKLIST.map(item => (
                    <div key={item.code} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-1.5">
                      <ClipboardList className="h-3.5 w-3.5 text-slate-500" />
                      <span className="font-mono font-bold text-[#2B124C]">{item.code}</span>
                      <span className="text-slate-700">{item.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-sm font-extrabold text-slate-900">
                  15 Automated ICOFR Financial Controls (Section 21)
                </h3>
                <p className="mb-3 text-xs text-slate-500">
                  Deteksi otomatis pelanggaran SoD, jurnal tidak seimbang, periode tertutup & duplikasi
                </p>
                <div className="max-h-64 space-y-1.5 overflow-y-auto text-xs">
                  {ICOFR_15_AUTOMATED_CONTROLS.map((ctrl, idx) => (
                    <div key={ctrl} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-1.5">
                      <span className="font-mono text-slate-800">
                        IC-{String(idx + 1).padStart(2, '0')} · {ctrl}
                      </span>
                      <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                        CATALOG
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeMenu === 'F25' && <CamsFinanceInbox key={selectedEntity || 'configured-scope'} entity={selectedEntity} />}
          {registers.map(register => (
            <div key={register.key} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-base font-extrabold text-slate-900">{currentMenuDef.id} · {register.key}</h3>
              <p className="mb-3 text-xs text-slate-500">Register dari API sesuai hak akses. Filter periode berlaku sesuai dataset server; daftar ini bukan laporan audit lengkap.</p>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead><tr className="border-b bg-slate-50">
                    {['Referensi','Deskripsi','Status','Debit / Nilai (IDR)','Kredit / Realisasi (IDR)'].map(label => <th key={label} className="px-3 py-2">{label}</th>)}
                  </tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {register.rows.length === 0 ? <tr><td colSpan={5} className="p-4 text-slate-500">Tidak ada baris yang dikembalikan oleh API.</td></tr> : register.rows.map((row, i) => (
                      <tr key={row.reference + ':' + i}>
                        <td className="px-3 py-2 font-mono">{row.reference || '—'}</td>
                        <td className="px-3 py-2">{row.description || '—'}</td>
                        <td className="px-3 py-2">{row.status || '—'}</td>
                        <td className="px-3 py-2">{/^-?\d+$/.test(row.debit) ? formatIDRFromCents(Number(row.debit)) : '—'}</td>
                        <td className="px-3 py-2">{/^-?\d+$/.test(row.credit) ? formatIDRFromCents(Number(row.credit)) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          </>}
        </section>
      </div>
    </div>
  );
}
