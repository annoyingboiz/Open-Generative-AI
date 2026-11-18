// Takes the ChatGPT credentials from the Mac helper on stdin and stores them
// encrypted for one person here. Run on the server, inside the gateway:
//   node tools/connect-chatgpt.mjs | ssh stand 'cd ~/projects/ai-video-platform && docker compose exec -T gateway node src/import-chatgpt.mjs denis'
// Prints only the account e-mail and owner — never tokens.
import { config } from './config.js';
import { openDatabase } from './db.js';
import { loadMasterKey } from './crypto.js';
import { createChatGpt } from './chatgpt.js';

const username = process.argv[2];
if (!username) { console.error('Usage: node src/import-chatgpt.mjs <username here>'); process.exit(2); }
let raw = '';
for await (const chunk of process.stdin) raw += chunk;
if (!raw.trim()) { console.error('Nothing on stdin. Pipe the output of tools/connect-chatgpt.mjs into this.'); process.exit(2); }
const db = openDatabase(config.dataDir);
const chatgpt = createChatGpt({ db, masterKey: loadMasterKey(config.dataDir, config.appSecret), config, log: console });
try {
  const r = chatgpt.importCredentials(raw, { username });
  console.log(`Connected ChatGPT account ${r.email || '(no e-mail)'} for ${r.owner}. The server keeps it fresh from now on.`);
} catch (error) {
  console.error(`Not connected: ${error.message}`);
  process.exit(1);
}
