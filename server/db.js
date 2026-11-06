import postgres from 'postgres';

function wrap(sql) {
 return {
  q: (text,params=[]) => sql.unsafe(text,params),
  tx: fn => sql.begin(transaction => fn(wrap(transaction)))
 };
}
export async function withDB(fn) {
 if (!process.env.DATABASE_URL) throw Object.assign(new Error('The community service is being set up. Please try again later.'),{status:503});
 const sql=postgres(process.env.DATABASE_URL,{max:1,ssl:'require',prepare:false,connect_timeout:15,idle_timeout:10});
 try { return await fn(wrap(sql)); } finally { await sql.end({timeout:2}); }
}
