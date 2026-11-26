// RTICore V4.0 Batch 19-20 — VAPT/DFIR/SOC Delivery, Live Finance Docking Outbox Bridge & Unified Enterprise SoD Approval Inbox
const test = require('node:test');
const assert = require('node:assert/strict');
const { Harness, users, tenant, expect } = require('./helpers/sales-flow-harness.cjs');

function setupOrg(h) {
  for (const [k, email] of Object.entries(users)) {
    const role = k === 'other' ? 'sales' : k === 'admin2' ? 'admin' : k === 'pm_other' ? 'project_manager' : k;
    h.sql.prepare("INSERT OR IGNORE INTO rticore_members(email,role,active,created_by) VALUES(?,?,1,'TEST')").run(email, role);
  }
  h.sql.prepare("INSERT INTO rticore_erp_org_units(id,tenant_id,code,label,kind,active,created_by) VALUES('le-19-a',?,'B19A','PT RTI Delivery A','legal_entity',1,?),( 'le-19-b',?,'B19B','PT RTI Delivery B','legal_entity',1,?)")
    .run(tenant, users.admin, tenant, users.admin);
  for (const email of [users.admin, users.finance, users.approver, users.presales, users.project_manager, users.offense_lead, users.offense_member, users.defense_leader, users.defense_member]) {
    const reviewer = email === users.approver ? users.admin2 : users.approver;
    const creator = email === users.admin ? users.admin2 : users.admin;
    h.sql.prepare("INSERT OR IGNORE INTO rticore_erp_staff_org(tenant_id,email,unit_id,position_title,created_by,status,reviewed_by,review_notes) VALUES(?,?,?, 'Delivery Staff',?,'approved',?,'Approved legal entity scope for Batch 19')")
      .run(tenant, email, 'le-19-a', creator, reviewer);
  }
}

test('Batch 19-20: VAPT RoE/Findings/Retest, DFIR Immutable Chain of Custody, SOC SLA, Docking Bridge & Unified SoD Inbox', async (t) => {
  const h = new Harness().seed();
  try {
    setupOrg(h);

    await t.test('M11 VAPT Lifecycle: RoE gate, SoD authorization, CVSS findings, QA SoD & retest', async () => {
      const eng = await expect(h.call('erp/cyber-delivery', 'POST', 'offense_lead', {
        action: 'register_vapt_engagement', legal_entity_id: 'le-19-a', engagement_code: 'VAPT-2026-901',
        title: 'Core Payment Gateway Penetration Test', test_type: 'api', window_start: '2026-11-26', window_end: '2026-12-10',
      }), 201);

      // Finding cannot be logged before RoE authorization!
      await expect(h.call('erp/cyber-delivery', 'POST', 'offense_member', {
        action: 'log_vapt_finding', engagement_id: eng.body.id, finding_code: 'F-001',
        title: 'BOLA on Payment Status API', severity: 'critical', cvss_score_tenths: 91,
        affected_asset: 'https://api.bank.invalid/v1/payments/{id}',
        remediation_guidance: 'Enforce strict object-level authorization check against authenticated customer identity',
      }), 409);

      // Unified Enterprise SoD Approval Inbox shows VAPT RoE to Approver (NOT to offense_lead maker)
      const inboxApprover = await expect(h.call('erp/enterprise-approvals', 'GET', 'approver'), 200);
      assert.ok(inboxApprover.body.queue.some(q => q.module === 'vapt_roe_authorization' && q.id === eng.body.id));

      // Maker self-approval of RoE blocked
      await expect(h.call('erp/cyber-delivery', 'POST', 'offense_lead', {
        action: 'approve_vapt_roe', engagement_id: eng.body.id, authorization_notes: 'Self approval attempt must be rejected',
      }), 403);

      // Independent Approver authorizes RoE
      await expect(h.call('erp/cyber-delivery', 'POST', 'approver', {
        action: 'approve_vapt_roe', engagement_id: eng.body.id, authorization_notes: 'Signed customer Rules of Engagement verified in Vault',
      }), 200);

      // Now Offense Member logs critical CVSS 9.1 finding
      const finding = await expect(h.call('erp/cyber-delivery', 'POST', 'offense_member', {
        action: 'log_vapt_finding', engagement_id: eng.body.id, finding_code: 'F-001',
        title: 'BOLA on Payment Status API', severity: 'critical', cvss_score_tenths: 91,
        affected_asset: 'https://api.bank.invalid/v1/payments/{id}',
        remediation_guidance: 'Enforce strict object-level authorization check against authenticated customer identity',
      }), 201);

      // QA review by independent Offense Lead succeeds, then retest verified fixed
      await expect(h.call('erp/cyber-delivery', 'POST', 'offense_lead', {
        action: 'qa_or_retest_finding', finding_id: finding.body.id, retest_status: 'qa_approved',
        notes: 'Peer reviewed reproduction steps, CVSS 9.1 vector and evidence',
      }), 200);
      await expect(h.call('erp/cyber-delivery', 'POST', 'offense_lead', {
        action: 'qa_or_retest_finding', finding_id: finding.body.id, retest_status: 'verified_fixed',
        notes: 'Retested against patched build v2.4; unauthorized object access now returns 403',
      }), 200);

      // Immutability triggers block delete
      assert.throws(() => h.sql.prepare('DELETE FROM rticore_vapt_findings WHERE id=?').run(finding.body.id), /VAPT_FINDING_IMMUTABLE/);
      assert.throws(() => h.sql.prepare('DELETE FROM rticore_vapt_engagements WHERE id=?').run(eng.body.id), /VAPT_ENGAGEMENT_IMMUTABLE/);
    });

    await t.test('M13 DFIR Incident & Immutable Forensic Chain of Custody', async () => {
      const inc = await expect(h.call('erp/cyber-delivery', 'POST', 'defense_leader', {
        action: 'create_dfir_incident', legal_entity_id: 'le-19-a', incident_code: 'DFIR-2026-77',
        title: 'Suspected Domain Controller Credential Dumping', severity: 'sev1_critical', emergency_mandays_tenths: 40,
      }), 201);

      const coc = await expect(h.call('erp/cyber-delivery', 'POST', 'defense_member', {
        action: 'append_chain_of_custody', incident_id: inc.body.id, evidence_tag: 'EVD-DC01-MEM',
        evidence_description: 'Full 64GB RAM acquisition image from DC-01',
        sha256_hash: 'a'.repeat(64), custody_action: 'collected', storage_location: 'Forensic Vault Rack-B Locker-02',
        notes: 'Collected live via write-blocked forensic media and hashed immediately',
      }), 201);

      // Chain of Custody is strictly immutable (NO UPDATE, NO DELETE)
      assert.throws(() => h.sql.prepare('UPDATE rticore_dfir_chain_of_custody SET sha256_hash=? WHERE id=?').run('b'.repeat(64), coc.body.id), /DFIR_CHAIN_OF_CUSTODY_IMMUTABLE/);
      assert.throws(() => h.sql.prepare('DELETE FROM rticore_dfir_chain_of_custody WHERE id=?').run(coc.body.id), /DFIR_CHAIN_OF_CUSTODY_IMMUTABLE/);
    });

    await t.test('M12 SOC/MDR Monthly SLA & Profitability Masking', async () => {
      await expect(h.call('erp/cyber-delivery', 'POST', 'defense_leader', {
        action: 'record_soc_sla', legal_entity_id: 'le-19-a', period_code: '2026-11',
        monitored_assets: 1200, active_use_cases: 145, alerts_triaged: 4820, incidents_escalated: 14,
        mttd_minutes: 8, mttr_minutes: 34, sla_compliance_bps: 9960,
        subscription_revenue_cents: 150_000_000_00, direct_soc_cost_cents: 72_000_000_00,
      }), 201);

      const finView = await expect(h.call('erp/cyber-delivery', 'GET', 'finance', null, '?legal_entity_id=le-19-a'), 200);
      assert.equal(finView.body.soc_sla_metrics[0].soc_gross_profit_cents, 78_000_000_00);

      const defView = await expect(h.call('erp/cyber-delivery', 'GET', 'defense_member', null, '?legal_entity_id=le-19-a'), 200);
      assert.equal(defView.body.soc_sla_metrics[0].soc_gross_profit_cents, undefined);
      assert.equal(defView.body.soc_sla_metrics[0].subscription_revenue_cents, undefined);

      // Cross-entity access denied
      await expect(h.call('erp/cyber-delivery', 'GET', 'finance', null, '?legal_entity_id=le-19-b'), 403);
    });

    await t.test('Live Finance Docking Outbox Bridge: Inspect, Process, Quarantine & Hostinger Fail-Closed', async () => {
      const bridge = h.load('src/lib/finance-docking-bridge.ts');
      const { eventId, stmt } = await bridge.buildFinanceOutboxStatement(h, {
        legalEntityId: 'le-19-a',
        eventType: 'timesheet.approved',
        sourceDocumentId: 'ts-live-001',
        idempotencyKey: 'ts-live-approve-001',
        payload: { project_id: 'proj-01', minutes: 480, cost_snapshot_cents: 1_800_000_00 },
      });
      await stmt.run();
      await assert.rejects(bridge.buildFinanceOutboxStatement(h,{legalEntityId:'le-19-a',eventType:'timesheet.approved',sourceDocumentId:'ts-live-001',idempotencyKey:'x'.repeat(161),payload:{}}),/INVALID finance idempotency key/);
      assert.equal(await bridge.verifyFinancePayload('[]',await bridge.financePayloadSha256('[]')),false);
      const stored = h.sql.prepare('SELECT payload_json,payload_sha256 FROM rticore_finance_integration_events WHERE id=?').get(eventId);
      assert.equal(stored.payload_sha256, require('node:crypto').createHash('sha256').update(stored.payload_json).digest('hex'));
      h.sql.prepare('UPDATE rticore_finance_integration_events SET payload_json=? WHERE id=?').run('{"minutes":999}',eventId);
      await expect(h.call('erp/finance-docking-bridge','POST','finance',{action:'process_event',event_id:eventId}),409);
      assert.equal(h.sql.prepare('SELECT status FROM rticore_finance_integration_events WHERE id=?').get(eventId).status,'received');
      h.sql.prepare('UPDATE rticore_finance_integration_events SET payload_json=? WHERE id=?').run(stored.payload_json,eventId);

      const list = await expect(h.call('erp/finance-docking-bridge', 'GET', 'finance', null, '?legal_entity_id=le-19-a'), 200);
      assert.ok(list.body.events.some(e => e.id === eventId && e.status === 'received'));

      const proc = await expect(h.call('erp/finance-docking-bridge', 'POST', 'finance', {
        action: 'process_event', event_id: eventId,
      }), 200);
      assert.equal(proc.body.status, 'validated');
      assert.deepEqual(h.sql.prepare('SELECT status,processed_at,processed_by,resulting_journal_id FROM rticore_finance_integration_events WHERE id=?').get(eventId), {status:'validated',processed_at:null,processed_by:null,resulting_journal_id:null});

      // Reprocessing same event rejected (409)
      await expect(h.call('erp/finance-docking-bridge', 'POST', 'finance', {
        action: 'process_event', event_id: eventId,
      }), 409);

      // Hostinger runtime remains fail-closed (503) for Finance docking bridge
      const prior = process.env.RTICORE_RUNTIME;
      try {
        process.env.RTICORE_RUNTIME = 'hostinger';
        await expect(h.call('erp/finance-docking-bridge', 'GET', 'finance', null, '?legal_entity_id=le-19-a'), 503);
      } finally {
        if (prior === undefined) delete process.env.RTICORE_RUNTIME;
        else process.env.RTICORE_RUNTIME = prior;
      }
    });
  } finally {
    h.close();
  }
});
