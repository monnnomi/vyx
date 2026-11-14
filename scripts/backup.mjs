import {mkdir,chmod,readdir,rm,rename} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
const root='/var/backups/vyx';
const name=new Date().toISOString().replace(/[:.]/g,'-');
const staging=join(root,name+'.pending'),destination=join(root,name);
await mkdir(staging,{recursive:true,mode:0o700});
await chmod(root,0o700);
const url=new URL(process.env.DATABASE_URL);
const env={...process.env,PGHOST:url.hostname,PGPORT:url.port||'5432',PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGDATABASE:decodeURIComponent(url.pathname.slice(1)),PGSSLMODE:'require'};
for(const [binary,args] of [
 ['/usr/lib/postgresql/18/bin/pg_dump',['-Fc','--no-owner','--no-privileges','-f',join(staging,'database.dump')]],
 ['/bin/tar',['-czf',join(staging,'media.tar.gz'),'-C',process.env.MEDIA_STORAGE_DIR,'.']]
]){
 const result=spawnSync(binary,args,{env,stdio:['ignore','ignore','inherit'],timeout:300000});
 if(result.status!==0)throw Error('Backup did not complete');
}
for(const file of ['database.dump','media.tar.gz'])await chmod(join(staging,file),0o600);
await rename(staging,destination);
const completed=(await readdir(root)).filter(n=>/^\d{4}-\d\d-\d\dT[\d-]+Z$/.test(n)).sort().reverse();
for(const old of completed.slice(7))await rm(join(root,old),{recursive:true});
console.log('VYX database and private media backup completed');
