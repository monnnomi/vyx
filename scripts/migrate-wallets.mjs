import {withDB} from '../server/db.js';
import {migrateWallets} from '../server/wallets.js';
// Additive and repeatable: creates the wallet-link tables when they are missing.
await withDB(db=>migrateWallets(db));
console.log('Wallet links are ready.');
