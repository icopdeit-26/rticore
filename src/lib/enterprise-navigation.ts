/**
 * Canonical RTICORE navigation: reuse existing, authenticated D1-backed routes.
 * This only shapes the UI. Every API must independently authorize role + object.
 * Do not add legacy demo pages or inferred approvals/KPI counts here.
 */
import type { BoQRole } from './boq-domain';

export type RTICoreNavItem = {
  readonly label: string;
  readonly href: string;
  readonly roles: readonly BoQRole[];
};
export type RTICoreNavGroup = {
  readonly id: string;
  readonly label: string;
  readonly items: readonly RTICoreNavItem[];
};
const ALL: BoQRole[] = ['admin','marketing','sales','presales','finance','approver','legal','project_manager','offense_lead','offense_member','defense_leader','defense_member','governance_leader','governance_member','itdev_leader','itdev_member','viewer'];
// IT Developer Team (0051): scoped by the APIs to allocated Technology & Implementation projects;
// Leader also reads Technology Feasibility. Both read platform diagnostics (Leader: + technical audit).
const ITDEV: BoQRole[] = ['itdev_leader','itdev_member'];
// Offense Team (0048): scoped by the APIs to allocated Offensive Security projects; Leader also reads Offensive Feasibility.
const OFFENSE: BoQRole[] = ['offense_lead','offense_member'];
// Governance Team (0050): scoped by the APIs to allocated GRC projects; Leader also reads GRC Feasibility.
const GOVERNANCE: BoQRole[] = ['governance_leader','governance_member'];
// SOC Defense Team: scoped by the APIs to SOC/DFIR projects under an approved cyber_ops grant.
const DEFENSE: BoQRole[] = ['defense_leader','defense_member'];
const COMMERCIAL: BoQRole[] = ['admin','sales','presales','finance','approver','legal'];
const SALES: BoQRole[] = ['admin','sales','approver','finance'];
const PRESALES: BoQRole[] = ['admin','presales','approver','finance','legal'];
// Tender work where Sales is the maker (RKS/KAK register, clauses, bid checklist)
// or must see the gate blocking its Opportunity. APIs enforce ownership per deal.
const TENDER: BoQRole[] = [...PRESALES,'sales'];
const FINANCE: BoQRole[] = ['admin','finance','approver'];
const item = (label:string,href:string,roles: readonly BoQRole[]):RTICoreNavItem => ({label,href,roles});

export const RTICORE_NAVIGATION: readonly RTICoreNavGroup[] = [
  {id:'workspace',label:'01 · Executive & My Workspace',items:[
    item('Executive Dashboard','/sales/executive',['admin','finance','approver']),
    item('Activity, SLA & Follow-up','/sales/activities',SALES),
    item('Sales Forecast','/sales/forecast',SALES),
  ]},
  {id:'marketing',label:'02 · Marketing & Lead Intelligence',items:[
    item('Campaign Management','/sales/campaigns',['admin','marketing','sales']),
    item('Lead Register','/sales/leads',['admin','marketing','sales']),
    item('Lead Scoring & Nurturing','/sales/lead-intelligence',['admin','marketing','sales']),
  ]},
  {id:'crm',label:'03 · Customer 360 & Sales CRM',items:[
    item('Customer 360','/customers',COMMERCIAL),
    item('Opportunity Pipeline','/sales/pipeline',SALES),
    item('Communication Timeline','/sales/communications',['admin','sales','approver','legal']),
  ]},
  {id:'presales',label:'04 · Presales, Tender & Solution',items:[
    item('Smart Scoping & Sizing','/scoping',['admin','presales','sales']),
    item('Tender Compliance','/sales/compliance',TENDER),
    item('Bid Readiness','/sales/bid-readiness',TENDER),
    item('Resource & Solution Feasibility','/sales/feasibility',[...TENDER,'governance_leader','offense_lead','itdev_leader']),
  ]},
  {id:'commercial',label:'05 · Commercial, Pricing & Approval',items:[
    item('BoQ Management','/boq',[...COMMERCIAL,'viewer']),
    item('Approval Center · Lintas Modul','/approvals',COMMERCIAL),
    item('PO / SPK Verification','/sales/award',['admin','sales','finance','approver','legal']),
    item('Submission & Proposal Evidence','/sales/submission',COMMERCIAL),
  ]},
  {id:'delivery',label:'06 · Project Delivery & Operations',items:[
    // project_manager: scoped by the API to projects where it is the assigned PM.
    item('Service Delivery & Projects','/sales/delivery',['admin','presales','project_manager','finance','approver',...OFFENSE,...GOVERNANCE,...ITDEV]),
    item('Project Timesheets','/psa/timesheets',['admin','presales','project_manager','finance','approver',...OFFENSE,...GOVERNANCE,...DEFENSE,...ITDEV]),
    item('Official Post-PO Forms','/post-po',['admin','sales','presales','finance','approver','legal']),
  ]},
  {id:'cash',label:'07 · Contract-to-Cash & Renewal',items:[
    item('Billing & Collections','/sales/billing',FINANCE),
    item('Revenue Register','/sales/revenue',FINANCE),
    item('Contracts & Renewal','/sales/renewals',COMMERCIAL),
    item('FlexGuard Token Wallet','/flexguard',['admin','sales','presales','project_manager','finance','approver']),
  ]},
  {id:'partners',label:'08 · Vendor, OEM & Partners',items:[
    item('Vendor & Partner Records','/partners',PRESALES),
    item('Procurement & Supplier','/sales/procurement',TENDER),
  ]},
  {id:'reporting',label:'09 · Reporting, Analytics & AI',items:[
    item('Enterprise Reports','/reports',['admin','marketing','sales','finance','approver']),
  ]},
  {id:'governance',label:'10 · Document Center & Governance',items:[
    item('Secure Document Vault','/sales/documents',[...COMMERCIAL,'project_manager',...OFFENSE,...GOVERNANCE,...DEFENSE,...ITDEV]),
  ]},
  {id:'platform',label:'13 · Platform & Developer Tools',items:[
    // Read-only: no settings, keys or user registry. Audit section is Leader/Admin only (API-enforced).
    item('Platform Diagnostics','/platform/diagnostics',['admin',...ITDEV]),
  ]},
  {id:'enterprise_erp',label:'12 · ERP Finance, Procurement & Cybersecurity',items:[
    item('Organization & ERP Access','/erp/organization',['admin','approver']),
    item('General Ledger & Journal','/erp/general-ledger',['finance','approver']),
    item('Treasury & Payments','/erp/treasury',['admin','finance','approver']),
    item('Human Resources & Workforce','/erp/hr',['admin','approver']),
    item('SIEM / EDR Integrations','/erp/security-integrations',['admin','presales','approver',...DEFENSE]),
    item('Procurement & Accounts Payable','/erp/procurement',['admin','presales','finance','approver']),
    item('Cybersecurity Operations','/erp/cyber-operations',['admin','presales','approver',...DEFENSE]),
  ]},
  {id:'administration',label:'11 · Administrasi · Khusus Admin',items:[
    item('Registrasi User','/boq/users',['admin']),
    item('Parameter','/settings/system',['admin']),
    item('Opsi','/settings/options',['admin']),
    item('Registrasi Opsi Standar','/settings/option-registry',['admin']),
    item('API Key','/settings/ai',['admin']),
    item('Model Scoping & Harga','/settings/scoping-model',['admin']),
  ]},
] as const;

export function navigationForRole(role: string|null|undefined):RTICoreNavGroup[] {
  if(!role || !ALL.includes(role as BoQRole))return [];
  return RTICORE_NAVIGATION.map(group=>({...group,items:group.items.filter(link=>link.roles.includes(role as BoQRole))}))
    .filter(group=>group.items.length>0);
}

/**
 * For in-page shortcut links. Menu routes follow the role menu; contextual
 * workflow pages that are not menu items (e.g. /sales/lifecycle) stay visible
 * and remain protected by their API. UI hint only, never authorization.
 */
export function canOpenRoute(role:string|null|undefined,href:string):boolean{
  const pathOnly=href.split('?')[0];
  const owner=RTICORE_NAVIGATION.flatMap(group=>group.items).find(link=>link.href===pathOnly);
  if(!owner)return true;
  return !!role&&owner.roles.includes(role as BoQRole);
}

// Role whose daily work is not the first menu item lands on its own desk.
export const LANDING:Readonly<Record<string,string>>={defense_leader:'/erp/cyber-operations',defense_member:'/erp/cyber-operations',offense_lead:'/sales/delivery',offense_member:'/sales/delivery',governance_leader:'/sales/delivery',governance_member:'/sales/delivery'};
export function firstAccessibleHref(role:string|null|undefined):string|null {
  if(role&&LANDING[role]&&canOpenRoute(role,LANDING[role]))return LANDING[role];
  return navigationForRole(role)[0]?.items[0]?.href??null;
}
