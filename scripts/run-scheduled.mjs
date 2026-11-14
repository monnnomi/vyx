const action=process.argv[2];
if(!['news','farm'].includes(action)||!process.env.CRON_SECRET)throw Error('Choose a configured scheduled job');
// The public origin stays unchanged for OAuth/CSRF. Internal jobs use loopback.
const response=await fetch('http://127.0.0.1:'+String(process.env.PORT||4173)+'/api/'+action+'-cron',{headers:{Authorization:'Bearer '+process.env.CRON_SECRET},signal:AbortSignal.timeout(70000)});
if(!response.ok)throw Error('Scheduled job returned '+response.status);
console.log(action+' scheduled job completed');
