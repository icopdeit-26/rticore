import type {Metadata} from 'next';
import {ArrowRight, ArrowUpRight, BadgeCheck, Building2, ChartNoAxesCombined, Check, KeyRound, Layers3, LockKeyhole, ShieldCheck} from 'lucide-react';
import {LoginSessionStatus} from '@/components/auth/LoginSessionStatus';
import {LocalLoginPanel} from '@/components/auth/LocalLoginPanel';
import {LogoutButton} from '@/components/auth/LogoutButton';
import {isLocalMode} from '@/lib/runtime-env';

export const dynamic='force-dynamic';

export const metadata: Metadata = {
  title: 'Login RTICORE | RTI',
  description: 'Masuk ke RTICORE Enterprise ERP & PSA dengan akun terdaftar dan hak akses sesuai role.',
};

export default function RTICoreLoginPage() {
  const localMode=isLocalMode();
  const nativeMode=process.env.RTICORE_RUNTIME==='hostinger';
  return (
    <main className="relative isolate min-h-[100dvh] overflow-x-hidden bg-[#f5f7fa] text-slate-900">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_100%_0%,rgba(45,212,191,0.12),transparent_45%)]" />
      <div className="relative mx-auto flex min-h-[100dvh] max-w-[1440px] flex-col px-5 py-6 sm:px-10 lg:px-14 lg:py-8">
        <header className="flex items-center justify-between gap-4">
          <a href="/login" aria-label="RTICORE beranda login" className="flex items-center gap-3 rounded-xl focus-visible:outline-2 focus-visible:outline-teal-600">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white p-1.5 shadow-sm ring-1 ring-slate-200/70">
              <img src="/logo-rti-light.png" alt="Logo RTI - RiseT Indonesia" width={32} height={32} style={{width:32,height:32,objectFit:'contain'}} className="h-full w-full object-contain" />
            </span>
            <div>
              <p className="text-xl font-extrabold tracking-tight">RTI<span className="text-teal-700">CORE</span></p>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">Enterprise platform</p>
            </div>
          </a>
          <span className="hidden items-center gap-2 rounded-full border border-slate-200 bg-white/80 px-3 py-2 text-xs font-medium text-slate-600 sm:inline-flex">
            <ShieldCheck className="h-4 w-4 text-teal-700" aria-hidden="true" /> Akses workspace perusahaan
          </span>
        </header>

        <div className="grid flex-1 items-center gap-9 py-8 lg:grid-cols-[1.12fr_1fr] lg:gap-12 xl:gap-20">
          <section className="relative hidden h-full min-h-[650px] flex-col justify-between overflow-hidden rounded-[32px] bg-[#102c36] p-9 text-white lg:flex xl:p-12" aria-label="Tentang platform RTICORE">
            <div aria-hidden="true" className="pointer-events-none absolute -right-24 top-20 h-96 w-96 rounded-full border-[60px] border-teal-300/[0.04]" />
            <div className="relative">
              <p className="inline-flex items-center gap-2 rounded-full border border-teal-200/20 bg-teal-200/5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.17em] text-teal-200"><span className="h-1.5 w-1.5 rounded-full bg-teal-300" /> Cybersecurity Enterprise ERP + PSA</p>
              <h2 className="mt-7 max-w-lg text-[42px] font-semibold leading-[1.12] tracking-[-0.045em] xl:text-[54px]">Bisnis terhubung.<br /><span className="text-[#8ee6ce]">Langkah lebih maju.</span></h2>
              <p className="mt-5 max-w-sm text-sm leading-7 text-slate-300">Satu workspace untuk menyatukan tim, mengelola operasional, dan menghadirkan layanan keamanan siber.</p>
            </div>

            <div className="relative my-8 rounded-2xl border border-white/15 bg-white/[0.06] p-5 shadow-2xl shadow-black/10" aria-label="Ilustrasi alur kerja terintegrasi">
              <div className="flex items-center justify-between border-b border-white/10 pb-4">
                <span className="flex items-center gap-2 text-xs font-medium text-teal-100"><Layers3 className="h-4 w-4" aria-hidden="true" /> RTICORE Workspace</span>
                <span className="text-[10px] text-slate-400">Alur terintegrasi</span>
              </div>
              <div className="my-5 flex items-center gap-2">
                {['Marketing', 'Sales', 'Delivery'].map((label, index) => <div key={label} className="flex min-w-0 flex-1 items-center gap-2">
                  <div className="flex-1 rounded-xl border border-white/10 bg-[#1d3d46] px-2 py-3 text-center">
                    <span className="mb-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-teal-200/10 text-[10px] font-semibold text-teal-200">0{index + 1}</span>
                    <p className="text-[11px] font-medium text-slate-200">{label}</p>
                  </div>
                  {index < 2 && <ArrowRight className="h-3 w-3 shrink-0 text-teal-300/60" aria-hidden="true" />}
                </div>)}
              </div>
              <div className="flex items-center justify-between gap-3 rounded-xl bg-teal-200/10 px-3 py-3">
                <span className="flex items-center gap-2 text-xs text-teal-100"><ChartNoAxesCombined className="h-4 w-4" aria-hidden="true" /> Visibilitas di setiap tahap</span>
                <ArrowUpRight className="h-4 w-4 text-teal-200" aria-hidden="true" />
              </div>
            </div>

            <div className="relative grid grid-cols-3 gap-4 border-t border-white/10 pt-6">
              {[{icon:Building2, title:'Terintegrasi', detail:'ERP, CRM & PSA'}, {icon:KeyRound, title:'Berbasis role', detail:'Akses sesuai peran'}, {icon:BadgeCheck, title:'Terverifikasi', detail:'Identitas & audit'}].map(({icon:Icon,title,detail}) => <div key={title}>
                <Icon className="mb-3 h-5 w-5 text-[#8ee6ce]" aria-hidden="true" />
                <p className="text-xs font-semibold">{title}</p><p className="mt-1 text-[10px] leading-5 text-slate-400">{detail}</p>
              </div>)}
            </div>
          </section>

          <section aria-labelledby="login-heading" className="mx-auto w-full max-w-[440px]">
            <div className="mb-7">
              <span className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-teal-100 bg-white text-teal-700 shadow-sm"><LockKeyhole className="h-5 w-5" aria-hidden="true" /></span>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-teal-700">Selamat datang kembali</p>
              <h1 id="login-heading" className="mt-3 text-[34px] font-semibold leading-tight tracking-[-0.04em] text-slate-950">Login RTICORE</h1>
              <p className="mt-3 max-w-sm text-sm leading-6 text-slate-500">Masuk ke workspace Anda dan lanjutkan hal-hal hebat bersama tim.</p>
            </div>

            <div className="rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-[0_12px_48px_-16px_rgba(15,44,54,0.12)] sm:p-7">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-slate-800">Akses perusahaan</p>
                <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2 py-1 text-[10px] font-semibold text-teal-700"><ShieldCheck className="h-3 w-3" aria-hidden="true" /> Secure access</span>
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-500">{localMode?'Pilih akun terdaftar untuk masuk ke workspace lokal. Hak akses mengikuti role akun Anda.':nativeMode?'Gunakan akun perusahaan melalui SSO independen dengan password dan kode autentikator (MFA).':'Layanan identitas belum dikonfigurasi. Hubungi administrator.'}</p>

              <LoginSessionStatus />
              <LocalLoginPanel />

              {nativeMode&&!localMode&&<a href="/oauth2/start?rd=%2Flogin" className="group mt-6 flex min-h-12 w-full items-center justify-center gap-3 rounded-xl bg-[#0f766e] px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#115e59] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600">
                <LockKeyhole className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="flex-1 text-center">Masuk dengan SSO + MFA</span>
                <ArrowRight className="h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none" aria-hidden="true" />
              </a>}
              <LogoutButton className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-teal-600"/>
              <p className="mt-5 flex items-start gap-2 border-t border-slate-100 pt-4 text-[11px] leading-5 text-slate-500"><Check className="mt-1 h-3.5 w-3.5 shrink-0 text-teal-600" aria-hidden="true" />{localMode?'Sesi login diproses di komputer ini tanpa layanan cloud.':'RTICORE tidak menyimpan password atau kode OTP pengguna.'}</p>
            </div>
            <p className="mx-auto mt-5 max-w-sm text-center text-xs leading-5 text-slate-500">Belum terdaftar atau role tidak sesuai? Hubungi Administrator RTICORE untuk aktivasi akun dan izin akses.</p>
          </section>
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-3 text-[10px] text-slate-500"><p>© 2026 RTI · Internal Business Platform</p><p className="flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> Dirancang untuk kolaborasi. Dilindungi di setiap langkah.</p></footer>
      </div>
    </main>
  );
}
