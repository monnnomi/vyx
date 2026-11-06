import {readFile,writeFile} from 'node:fs/promises';
const saved=JSON.parse(await readFile(new URL('../analytics-settings.json',import.meta.url),'utf8'));
const googleMeasurementId=(process.env.GA4_MEASUREMENT_ID||saved.googleMeasurementId||'').trim();
const yandexCounterId=String(process.env.YANDEX_METRIKA_ID||saved.yandexCounterId||'').trim();
if(googleMeasurementId&&!/^G-[A-Z0-9]{4,20}$/.test(googleMeasurementId))throw new Error('Invalid GA4 measurement ID');
if(yandexCounterId&&!/^[1-9]\d{4,11}$/.test(yandexCounterId))throw new Error('Invalid Yandex counter ID');
const config={enabled:process.env.VERCEL_ENV==='production',vercel:saved.vercel===true,googleMeasurementId,yandexCounterId};
await writeFile(new URL('../public/analytics-config.js',import.meta.url),'window.VYX_ANALYTICS='+JSON.stringify(config)+';\n');
console.log('Analytics configuration: '+(config.enabled?'production':'disabled outside production'));
