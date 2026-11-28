import DFIRCustody from '@/components/erp/DFIRCustody';
import ERPDesk from '@/components/erp/ERPDesk';
import DefenseTeamWorkspace from '@/components/erp/DefenseTeamWorkspace';
// SOC Defense board + role guide render only for Defense Team (or Admin); the generic desk stays below.
export default function Page(){return <><div className="mx-auto max-w-7xl space-y-5 px-4 pt-4 md:px-8 md:pt-8"><DefenseTeamWorkspace/><DFIRCustody/></div><ERPDesk desk="cyber-operations"/></>;}
