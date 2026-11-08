export default function LoadingWorkspace(){
 return <div role="status" aria-live="polite" className="space-y-5 py-4">
  <p className="text-sm font-medium text-slate-500">Membuka workspace…</p>
  <div aria-hidden="true" className="space-y-5 motion-safe:animate-pulse">
   <div className="h-44 rounded-3xl bg-slate-200/70"/>
   <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
    {[0,1,2,3].map(item=><div key={item} className="h-36 rounded-2xl border border-slate-200 bg-white"/>)}
   </div>
  </div>
 </div>;
}
