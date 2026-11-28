import test from 'node:test';import assert from 'node:assert/strict';import {secretKinds} from '../scripts/security-secret-scan.mjs';
test('recognizes high-confidence synthetic signatures without outputting material',()=>{
 const key=['-----BEGIN PRIVATE KEY-----','A'.repeat(32)].join('\n');
 assert.deepEqual(secretKinds(key),['private-key']);
 assert.deepEqual(secretKinds('gh'+'p_'+'A'.repeat(36)),['github-token']);
 assert.deepEqual(secretKinds('s'+'k-proj-'+'A'.repeat(48)),['openai-key']);
 assert.deepEqual(secretKinds('AK'+'IA'+'A'.repeat(16)),['aws-access-id']);
 assert.deepEqual(secretKinds('OPENAI_API_KEY=\nDATABASE_URL=postgresql://USER:PASSWORD@HOST/DB'),[]);
});
