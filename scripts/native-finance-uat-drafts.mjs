// Proposed business cases, not a claim that the grouped technical tests executed these IDs.
// Each family has a concrete control invariant and five independent acceptance variations.
const families={
 '01':[
 ['role-catalog','Inspect the configured 18 Finance roles','All required role IDs are unique; auditor and super-admin have no posting rights','admin','read'],
 ['menu-access','Open Finance menu F03 for an assigned entity','Only permitted menu and entity data are returned','finance','read'],
 ['role-request','Request Finance role assignment','Request remains pending until independently approved','admin','write'],
 ['role-approval','Review a pending role assignment','Independent authorized reviewer alone can approve; one grant is created','approver','write'],
 ['entity-membership','Inspect user membership and permitted entity','No records from an unassigned legal entity are disclosed','finance','read'],
 ['approval-limit','Evaluate journal approval against configured tier','Approval above the actor limit is denied','approver','calc'],
 ['profit-center','Register profit or cost center','Unique code within entity and valid parent hierarchy are enforced','finance','write']],
 '02':[
 ['coa','Register account with valid class and code','Account code unique per legal entity; classification persists','finance','write'],
 ['header','Attempt posting to header versus leaf account','Only posting-enabled leaf account is accepted','finance','write'],
 ['journal-types','Create journal with configured journal type','Valid type and required dimensions persist','finance','write'],
 ['dimensions','Validate journal accounting dimensions','Required entity dimensions exist and belong to the selected entity','finance','calc'],
 ['balance','Validate journal debit and credit totals','Debit equals credit exactly in minor units','finance','calc'],
 ['source','Create journal from source document','One journal per source key and entity','finance','write'],
 ['maker-checker','Review submitted journal','Maker cannot review own journal; independent reviewer decision audited','approver','write'],
 ['posting','Post approved journal in open period','Only approved balanced journal posts exactly once','approver','write'],
 ['immutability','Inspect or attempt change to posted journal','Posted header and lines remain immutable','finance','read'],
 ['reversal','Request exact journal reversal','Reversal references original and offsets amounts without altering original','finance','write'],
 ['trial-balance','Reconcile trial balance and posting rules','Debits equal credits and effective posting rule is deterministic','finance','calc']],
 '03':[
 ['milestone','Create invoice from accepted milestone','Invoice references accepted milestone and approved contract','finance','write'],
 ['invoice-review','Review draft customer invoice','Independent approval required before billing','approver','write'],
 ['receipt','Record customer payment receipt','Receipt amount and customer reference persist once','finance','write'],
 ['allocation','Allocate payment partially or fully','Allocation cannot exceed receipt or open invoice balance','finance','write'],
 ['adjustment','Review credit or debit note','Approved adjustment affects AR once and retains audit record','approver','write'],
 ['aging','Inspect customer aging','Open balance equals billing less valid payments and adjustments','finance','calc'],
 ['deposit','Record customer deposit','Deposit remains separately classified until valid allocation','finance','write'],
 ['revenue-separation','Reconcile billing, revenue and contract position','Billing alone does not recognize revenue; contract asset/liability reconciles','finance','calc']],
 '04 & 08':[
 ['vendor','Validate vendor master','Approved active vendor and entity are required','finance','read'],
 ['offer','Review supplier offer','Valid offer references approved vendor and procurement request','presales','read'],
 ['budget','Reserve approved procurement budget','Reservation respects remaining authorized budget','finance','write'],
 ['purchase-request','Submit purchase requisition','Request persists with scope and approval status','presales','write'],
 ['purchase-order','Issue purchase order from approved request','PO references approved request and vendor','presales','write'],
 ['po-review','Review purchase order','Independent review and budget guard enforced','approver','write'],
 ['goods-receipt','Record goods receipt against PO','Received quantity never exceeds ordered quantity','presales','write'],
 ['service-receipt','Accept service delivery against PO','Service acceptance has authorized supporting evidence','presales','write'],
 ['three-way-match','Match vendor invoice to PO and receipt','Invoice quantities and values satisfy matching rules','finance','calc'],
 ['vendor-bank','Request vendor bank account change','New bank account is not active without dual control','finance','write'],
 ['ap-invoice','Record supplier invoice','Supplier invoice number cannot duplicate within vendor/entity','finance','write'],
 ['vendor-advance','Record vendor advance or debit note','Advance or debit note reconciles to approved vendor ledger','finance','write'],
 ['payment-batch','Review AP payment batch','Net payable matches approved invoice less withholding and adjustments','approver','write']],
 '05':[
 ['cash-position','Inspect daily cash position','Opening plus inflows minus outflows equals closing','finance','calc'],
 ['weekly-forecast','Calculate 13-week rolling forecast','Weekly opening and closing balances roll forward consistently','finance','calc'],
 ['monthly-forecast','Calculate 12-month projection','Monthly cash forecast reconciles to underlying flows','finance','calc'],
 ['shortfall','Identify projected liquidity shortfall','Negative projected closing balance is flagged','finance','calc'],
 ['statement','Import bank statement lines','Unique statement references and immutable original amounts preserved','finance','write'],
 ['bank-match','Match bank transaction to ledger','Only eligible unmatched transactions are reconciled once','finance','write'],
 ['reconciliation','Inspect bank reconciliation','Unmatched items explain difference between bank and book balances','finance','calc']],
 '06':[
 ['contract','Identify approved customer contract','Revenue schedule references valid contract and consideration','finance','read'],
 ['obligations','Register performance obligations','Distinct obligations reference contract and delivery evidence','finance','write'],
 ['transaction-price','Validate transaction price','Price is valid positive consideration in minor units','finance','calc'],
 ['ssp','Allocate transaction price by standalone selling price','Allocation sums exactly to consideration','finance','calc'],
 ['obligation-review','Review performance obligations','Independent approval required before recognition','approver','write'],
 ['recognition','Recognize revenue on satisfied obligation','Recognition does not exceed allocated amount and requires evidence','finance','write'],
 ['contract-position','Reconcile contract asset and liability','Position follows cumulative recognition versus billing','finance','calc'],
 ['recognition-guard','Validate cumulative recognition limit','Excess recognition is rejected without ledger mutation','finance','calc']],
 '07':[
 ['actual-cost','Record project actual cost','Cost references eligible source and approved project entity','finance','write'],
 ['committed-cost','Record committed project cost','Commitment is classified separately from actual cost','finance','write'],
 ['cost-bucket','Validate seven cost-bucket mappings','Each valid cost classification maps to correct bucket','finance','calc'],
 ['dedup','Ingest project source cost','Identical source event does not double count','finance','write'],
 ['etc','Calculate estimate to complete','Remaining cost uses approved inputs','finance','calc'],
 ['eac','Calculate estimate at completion and margin','EAC and margin reconcile to source values','finance','calc'],
 ['certification','Inspect certified versus provisional margin','Only independently accepted complete inputs yield certified label','finance','read']],
 '09':[
 ['hard-budget','Register hard-limit budget','Budget has valid dimensions and enforced ceiling','finance','write'],
 ['soft-budget','Register soft-limit budget','Overrun warning is retained without unauthorized bypass','finance','write'],
 ['reservation','Reserve budget for approved expense','Reservation updates remaining budget exactly once','finance','write'],
 ['hard-overrun','Evaluate hard-limit overrun','Amount beyond remaining hard limit is rejected','finance','calc'],
 ['expense','Submit expense claim','Claim requires eligible claimant, scope and independent review','finance','write'],
 ['payroll','Review payroll accounting batch','Batch totals reconcile to approved source without revealing unauthorized data','approver','write'],
 ['fpa','Calculate FP&A scenario forecast','Base, optimistic, pessimistic or rolling inputs remain traceable','finance','calc']],
 '10':[
 ['tax-rule','Register configured Indonesian tax rule','Effective date and rate valid; approval required','finance','write'],
 ['tax-review','Review configured tax rule','Independent reviewer approves one version','approver','write'],
 ['tax-calculation','Calculate configured tax transaction','Basis-point calculation and settlement reconcile exactly','finance','calc'],
 ['asset','Register fixed asset','Asset cost, class and useful life validated','finance','write'],
 ['depreciation','Calculate straight-line depreciation','Expense and net book value reconcile; no negative carrying value','finance','calc'],
 ['license','Record license or subscription amortization','Remaining book value reconciles to amortization schedule','finance','calc']],
 '11':[
 ['contract-wallet','Create approved FlexGuard wallet','Wallet ties to approved contract and authorized credit purchase','finance','write'],
 ['issue-reserve','Issue or reserve credit','Available and reserved balances reflect eligible events without over-reservation','finance','write'],
 ['consumption','Consume reserved credit','Debit is linked to approved delivery and cannot exceed available credit','finance','write'],
 ['valuation','Value issue and debit events','Issue increases liability; debit recognizes eligible revenue once','finance','calc'],
 ['reconciliation','Reconcile wallet and contract liability','Opening plus purchase less consumption and expiry plus adjustments equals closing','finance','calc']],
 '12':[
 ['checklist','Inspect financial closing checklist','All required checklist items have attributable evidence','finance','read'],
 ['soft-close','Request soft close and review transition','Period transition follows allowed state sequence','finance','write'],
 ['hard-close','Approve and hard close period','Independent persisted approval and completed checklist required','approver','write'],
 ['reopen','Request controlled period reopen','Authorized reviewer and documented reason required','approver','write'],
 ['intercompany','Record intercompany elimination','Both entity scopes and offsetting records reconcile','finance','write'],
 ['subledger','Reconcile subledger to GL','Difference is zero or explicitly identified and unresolved','finance','calc'],
 ['consolidation','Inspect consolidated reporting','Only authorized entities and valid eliminations included','finance','read']],
 '13':[
 ['mode','Configure Finance docking mode','Only authorized mode changes with valid configuration persist','admin','write'],
 ['mapping','Register master data and COA mapping','Mapping is scoped, valid and independently reviewed','finance','write'],
 ['inbox','Ingest versioned docking event','Valid event enters scoped transactional inbox','finance','write'],
 ['idempotency','Replay event idempotency key','Duplicate event cannot create duplicate financial effects','finance','write'],
 ['retry','Retry failed eligible event','Retry obeys authorized state and bounded attempt policy','approver','write'],
 ['dlq','Inspect failed event dead-letter state','Failed event retains error and attempt history','finance','read'],
 ['acknowledgement','Reconcile source and Finance acknowledgement','Validated or retried event is not falsely reported as posted','finance','read']],
 '14':[
 ['detector','Inspect automated ICOFR exception detector','Detector identifies seeded exception and preserves trace','finance','read'],
 ['coso','Register control and assign owner','Control has valid COSO component and accountable owner','finance','write'],
 ['csrf','Submit request with invalid origin','Cross-origin mutation denied without business state change','finance','write'],
 ['tenant','Attempt cross-tenant access','Foreign tenant records inaccessible and unchanged','finance','read'],
 ['webhook','Validate stale webhook timestamp','Invalid timestamp rejected and no event ingested','finance','calc'],
 ['sod','Evaluate maker-checker and approval limits','Self-review or excess limit is rejected','approver','calc'],
 ['audit','Inspect financial audit trail','Authorized audit events are attributable, immutable and scoped','finance','read']],
 '15':[
 ['queries','Request read-only financial insight','Response cites authorized financial sources and assumptions','finance','read'],
 ['scope','Request financial insight for unassigned entity','No foreign entity data or hidden source is disclosed','finance','read'],
 ['mutation-guard','Request AI autonomous posting or payment approval','AI refuses mutation and no ledger or approval changes','finance','read'],
 ['input-guard','Submit empty or invalid financial query','Invalid request rejected without downstream financial effect','finance','read']]
};
const variations={
 write:[['authorized','Run authorized transition using approved staging fixture','Expected invariant holds in canonical PostgreSQL records'],['invalid','Submit invalid required field or invalid lifecycle state','Rejected; affected business records unchanged'],['scope','Repeat with unauthorized actor or foreign entity fixture','Denied; no foreign record disclosed or changed'],['replay','Repeat same request or business key after first result','No duplicate business effect; deterministic result or conflict'],['audit','Inspect persisted transition and evidence as independent authorized reviewer','Actor, entity, reference and outcome correlate to trace']],
 read:[['authorized','Read authorized staging fixture','Expected invariant and permitted values verified'],['missing','Read missing or empty fixture','Safe empty or not-found response; no fabricated record'],['scope','Read with unauthorized actor or foreign entity fixture','Denied or filtered with no foreign data leakage'],['repeat','Repeat identical read with unchanged fixture','No business mutation; deterministic source values'],['audit','Reconcile returned values to canonical sources and request trace','Source IDs and actor/entity evidence correlate']],
 calc:[['nominal','Evaluate valid representative fixture','Expected invariant holds against independent calculation'],['boundary','Evaluate zero, threshold or invalid boundary appropriate to the rule','Documented boundary result or explicit rejection; no unintended mutation'],['scope','Attempt calculation with foreign or unauthorized entity inputs','Denied or filtered; no unauthorized values disclosed'],['repeat','Repeat calculation with unchanged inputs','Same result without duplicate side effects'],['reconcile','Recompute using canonical inputs and independent reviewer','Expected invariant and precision reconcile with attributable evidence']]
};
export function proposedFinanceDefinitions(groups){
 return groups.flatMap(g=>{
  const rows=families[g.domains];if(!rows||rows.length*5!==g.target)throw Error('FINANCE_DRAFT_COUNT_DRIFT_'+g.domains);
  return rows.flatMap(([family,scenario,invariant,actor,kind],i)=>variations[kind].map(([variant,step,expected],j)=>({
   id:'FIN-'+g.domains.replace(' & ','-')+'-'+String(i*5+j+1).padStart(3,'0'),group:g.title,family,variant,
   scenario:scenario+' — '+variant,steps:[step],expected:invariant+'. '+expected+'.',
   actor,actor_role:null,proposed_actor_role:actor,approved_by:null,status:'REVIEW_REQUIRED_NOT_RUN',
   provenance:'proposed_native_business_case_not_legacy_assertion_mapping'
  })));
 });
}
