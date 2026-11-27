/** Native Hostinger sends AI requests exclusively to the configured OpenAI account. Legacy offline fixtures remain usable. */
export function providerAllowed(id:string,runtime:string|undefined):boolean {
 return runtime==='hostinger'?id==='openai':true;
}
