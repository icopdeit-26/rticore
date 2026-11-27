import {navigationForRole} from './enterprise-navigation';
export function searchRoleNavigation(role:string|null|undefined,query:string){
 const terms=query.trim().toLowerCase().split(/\s+/).filter(Boolean);
 const seen=new Set<string>();
 return navigationForRole(role).flatMap(group=>group.items.flatMap(item=>{
  if(seen.has(item.href))return [];
  seen.add(item.href);
  return [{href:item.href,label:item.label,group:group.label}];
 })).filter(item=>terms.every(term=>`${item.label} ${item.group} ${item.href}`.toLowerCase().includes(term))).slice(0,16);
}
