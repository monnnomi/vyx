import {build} from 'esbuild';
await build({entryPoints:['client/media-upload.js'],bundle:true,format:'esm',platform:'browser',target:['es2022'],minify:true,outfile:'public/media-upload-sdk.js',legalComments:'none'});
console.log('Media upload client built.');
