process.env.VYX_RUNTIME='node';process.env.NODE_ENV='production';
if(!process.env.PUBLIC_APP_URL||!process.env.DATABASE_URL||!process.env.VYX_APP_SECRET)throw Error('Missing production settings');
const {createStandaloneServer}=await import('../server/standalone.js');
const {drainBackground}=await import('../server/background.js');
const server=createStandaloneServer();
server.listen(Number(process.env.PORT||4173),'127.0.0.1',()=>console.log('VYX server is ready'));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{server.close(async()=>{await drainBackground();process.exit(0);});setTimeout(()=>process.exit(1),20000).unref();});
