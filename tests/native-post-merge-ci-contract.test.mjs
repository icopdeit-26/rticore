import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const gates=["cams-native-draft-acceptance.yml","operational-finance-outbox-ci.yml","pr1-residual-regression.yml","v6-integration-uat.yml","flexguard-release-evidence-ci.yml","business-hosting-release-contract-ci.yml","native-schema-inventory-ci.yml"];
test('critical read-only workflows run on main push and support deliberate rerun',()=>{
 for(const file of gates){
  const source=readFileSync('.github/workflows/'+file,'utf8');
  const events=source.split(/^permissions:/m)[0];
  const push=events.match(/^  push:\n    branches: \[([^\]]+)\]/m);
  assert.ok(push?.[1].split(',').map(s=>s.trim().replace(/^['"]|['"]$/g,'')).includes('main'),file);
  assert.match(events,/^  workflow_dispatch:/m,file);
  assert.doesNotMatch(events,/^    paths(?:-ignore)?:/m,file);
  assert.match(source,/^permissions:\n  contents: read/m,file);
  const checkouts=source.match(/      - uses: actions\/checkout@[^\n]+\n        with:\n          ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}\n          persist-credentials: false/g)||[];
  assert.equal(checkouts.length,(source.match(/      - uses: actions\/checkout@/g)||[]).length,file);
  assert.ok(checkouts.length>0,file);
 }
});
