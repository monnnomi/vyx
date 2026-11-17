// Validate shape, never report credential values. Provider authentication remains
// authoritative; this preflight catches placeholders accidentally copied in a move.
export function validateXConfig(env=process.env){
 const invalid=[];
 if(!/^[A-Za-z0-9_-]{24,256}$/.test(env.X_CLIENT_ID||''))invalid.push('X_CLIENT_ID');
 const secret=env.X_CLIENT_SECRET||'';
 if(secret.length<20||secret.length>512||/\s|•/.test(secret)||/^(?:[*.]+|placeholder|redacted|test[-_].*|dummy.*)$/i.test(secret))invalid.push('X_CLIENT_SECRET');
 if(invalid.length)throw Object.assign(new Error('Restore the existing VYX OAuth credentials: '+invalid.join(', ')+'.'),{code:'INVALID_X_OAUTH_CONFIG',status:503});
}
