-- Disposable CI acceptance, rolled back; no production feature activation.
BEGIN;
INSERT INTO rticore_feature_change_requests(id,tenant_id,legal_entity_id,flag_key,requested_enabled,reason,requested_by)
VALUES('fg-ci-1','defendit360','p0-rehearsal-a','service_catalog',true,'Synthetic release change request','maker@example.invalid');
DO $test$
BEGIN
 BEGIN
  INSERT INTO rticore_feature_change_requests(id,tenant_id,legal_entity_id,flag_key,requested_enabled,reason,requested_by) VALUES('fg-ci-duplicate','defendit360','p0-rehearsal-a','service_catalog',false,'Synthetic duplicate request','maker@example.invalid');
  RAISE EXCEPTION 'duplicate accepted';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 BEGIN
  UPDATE rticore_feature_change_requests SET status='approved',reviewed_by='MAKER@example.invalid',reviewed_at=now(),review_notes='Synthetic self approval' WHERE id='fg-ci-1';
  RAISE EXCEPTION 'self approval accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  INSERT INTO rticore_feature_change_requests(id,tenant_id,legal_entity_id,flag_key,requested_enabled,reason,requested_by) VALUES('fg-ci-foreign','defendit360','missing-entity','service_catalog',true,'Synthetic invalid entity','maker@example.invalid');
  RAISE EXCEPTION 'invalid entity accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 UPDATE rticore_feature_change_requests SET status='approved',reviewed_by='checker@example.invalid',reviewed_at=now(),review_notes='Synthetic independent approval' WHERE id='fg-ci-1';
 IF NOT EXISTS(SELECT 1 FROM rticore_feature_change_requests WHERE id='fg-ci-1' AND status='approved' AND reviewed_by='checker@example.invalid') THEN RAISE EXCEPTION 'independent approval missing'; END IF;
 BEGIN
  UPDATE rticore_feature_change_requests SET requested_enabled=false WHERE id='fg-ci-1';
  RAISE EXCEPTION 'mutation accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'FEATURE_IMMUTABLE' THEN RAISE; END IF; END;
 BEGIN
  DELETE FROM rticore_feature_change_requests WHERE id='fg-ci-1';
  RAISE EXCEPTION 'deletion accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'FEATURE_IMMUTABLE' THEN RAISE; END IF; END;
END $test$;
ROLLBACK;
