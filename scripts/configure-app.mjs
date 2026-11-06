import {randomBytes} from 'node:crypto';
import {appendFile,chmod} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
try{process.loadEnvFile('.env.local');}catch{}
const publicAppURL=new URL(process.env.PUBLIC_APP_URL||'https://joinvyx.com').origin;
let secret=process.env.VYX_APP_SECRET;
if(!secret){secret=randomBytes(32).toString('base64url');await appendFile('.env.local',`\nVYX_APP_SECRET=${secret}\nPUBLIC_APP_URL=${publicAppURL}\n`);await chmod('.env.local',0o600);}
for(const [name,value,sensitive] of [['VYX_APP_SECRET',secret,true],['PUBLIC_APP_URL',publicAppURL,false]]){
 const args=['env','add',name,'production,preview',sensitive?'--sensitive':'--no-sensitive','--yes'];
 const result=spawnSync('/Users/smt/.nvm/versions/node/v24.11.1/bin/vercel',args,{input:value,encoding:'utf8'});
 if(result.status!==0){console.error(`Could not save ${name}. Check Vercel environment settings.`);process.exit(1);}
 console.log(`${name} saved in Vercel.`);
}
