import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateXConfig} from '../server/x-config.js';
const valid={X_CLIENT_ID:'MjZFT0RZYnFvUDVhTXcySldKVXE6MTpjaQ',X_CLIENT_SECRET:'isolated-valid-shape-secret-1234567890'};
test('deployment accepts complete credentials, rejects masked or placeholder settings and never prints secrets',()=>{
 assert.doesNotThrow(()=>validateXConfig(valid));
 for(const fields of [{X_CLIENT_ID:'placeholder'},{X_CLIENT_SECRET:'placeholder'},{X_CLIENT_SECRET:'••••••••••••••••'},{X_CLIENT_SECRET:'wrong private secret with whitespace'},{X_CLIENT_ID:valid.X_CLIENT_ID+'\n'}]){
  assert.throws(()=>validateXConfig({...valid,...fields}),e=>e.code==='INVALID_X_OAUTH_CONFIG'&&e.status===503&&!e.message.includes(valid.X_CLIENT_SECRET)&&!Object.values(fields).some(v=>e.message.includes(v)));
 }
});
