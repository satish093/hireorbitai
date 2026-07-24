import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const env = readFileSync(join(homedir(), 'hireorbitai/backend/.env'), 'utf8');
const token = (env.match(/^ANTHROPIC_OAUTH_TOKEN=(.+)$/m) || [])[1] || '';
const client = new Anthropic({ authToken: token, maxRetries: 0 });

const models = [
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
  'claude-3-5-haiku-latest',
];

for (const model of models) {
  process.stdout.write(model + ' ... ');
  await new Promise((r) => setTimeout(r, 2000));
  try {
    const r = await client.messages.create({
      model,
      max_tokens: 20,
      messages: [{ role: 'user', content: 'Say OK' }],
    });
    const txt = r.content[0].type === 'text' ? r.content[0].text.trim() : '?';
    console.log('OK  ->', txt.slice(0, 30));
  } catch (e) {
    const status = e.status || '?';
    const type = (e.error && e.error.error && e.error.error.type) || e.type || '?';
    const msg = (e.error && e.error.error && e.error.error.message) || e.message || '?';
    console.log('FAIL  status=' + status + '  type=' + type + '  msg=' + msg.slice(0, 80));
  }
}
