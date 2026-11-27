export type BatchResult = {rows: Record<string, unknown>[]; rowCount?: number | null};
export type BatchClient = {query(text:string,params?:unknown[]):Promise<BatchResult>;release(error?:Error):void};
export async function executeAtomicBatch(pool:{connect():Promise<BatchClient>},statements:{sql:string;args:unknown[]}[]):Promise<BatchResult[]>{
  const client=await pool.connect();
  let discard:Error|undefined;
  try{
    await client.query('BEGIN');
    const results:BatchResult[]=[];
    for(const statement of statements)results.push(await client.query(statement.sql,statement.args));
    await client.query('COMMIT');
    return results;
  }catch(error){
    try{await client.query('ROLLBACK');}catch{discard=new Error('Rollback failed');}
    throw error;
  }finally{client.release(discard);}
}
