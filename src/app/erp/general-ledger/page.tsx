import Link from 'next/link';
import ERPDesk from '@/components/erp/ERPDesk';
export default function Page(){return <><nav aria-label="Finance workspace" className="mx-auto flex max-w-7xl flex-wrap gap-3 px-4 pt-4"><Link href="/finance" className="rounded-lg border px-4 py-3 text-sm font-semibold focus-visible:outline-2">Finance F01–F25</Link><Link href="/finance/F25" className="rounded-lg border px-4 py-3 text-sm font-semibold focus-visible:outline-2">CAMSRTI Finance Inbox</Link></nav><ERPDesk desk="ledger"/></>;}
