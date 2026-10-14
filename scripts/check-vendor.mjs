import {existsSync,readFileSync} from 'node:fs';
const file='web/vendor/jsQR.local.js';
if(!existsSync(file))throw Error('Decoder bundle missing. Run npm install && npm run build.');
const body=readFileSync(file,'utf8');
if(!body.includes('jsQR'))throw Error('Unexpected decoder bundle content');
console.log('Local decoder present:',body.length,'bytes');
