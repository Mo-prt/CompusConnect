-- Additive support for the sixteen-screen CampusConnect design.
-- Existing campus tables, records, enums and RLS policies are preserved.
BEGIN;

-- Optional classification used by the news filters in the supplied design.
ALTER TABLE public.news_posts ADD COLUMN IF NOT EXISTS category text;

CREATE TABLE IF NOT EXISTS public.campus_role_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id),
  requested_role text NOT NULL CHECK (requested_role IN ('teacher','organizer')),
  reason text NOT NULL CHECK (length(reason) BETWEEN 10 AND 2000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by uuid REFERENCES public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS campus_role_request_pending ON public.campus_role_requests(user_id,requested_role) WHERE status='pending';

CREATE TABLE IF NOT EXISTS public.campus_discussions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES public.collaboration_spaces(id),
  author_id uuid NOT NULL REFERENCES public.profiles(id),
  message text NOT NULL CHECK (length(message) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS campus_discussions_space ON public.campus_discussions(space_id,created_at);

CREATE TABLE IF NOT EXISTS public.campus_message_citations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.chat_messages(id),
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  title text NOT NULL,
  url text NOT NULL CHECK (url LIKE '#%'),
  UNIQUE(message_id,source_type,source_id)
);
CREATE TABLE IF NOT EXISTS public.campus_chat_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.chat_messages(id),
  user_id uuid NOT NULL REFERENCES public.profiles(id),
  is_relevant boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(message_id,user_id)
);

ALTER TABLE public.campus_role_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campus_discussions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campus_message_citations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campus_chat_feedback ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.campus_role_requests,public.campus_discussions,public.campus_message_citations,public.campus_chat_feedback FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.campus_role_requests,public.campus_discussions,public.campus_message_citations,public.campus_chat_feedback TO service_role;

CREATE OR REPLACE FUNCTION public.campus_publish_announcement(p_user_id uuid,p_module_id uuid,p_title text,p_body text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE announcement_id uuid;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM profiles WHERE id=p_user_id AND account_status='active') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(
    SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=p_user_id AND (
      r.code='admin' OR r.code='teacher' AND EXISTS(SELECT 1 FROM modules WHERE id=p_module_id AND responsible_teacher_id=p_user_id) OR
      r.code='department_head' AND EXISTS(SELECT 1 FROM program_modules pm JOIN programs p ON p.id=pm.program_id JOIN profiles actor ON actor.id=p_user_id WHERE pm.module_id=p_module_id AND p.department_id=actor.department_id)
    )
  ) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF length(trim(p_title)) NOT BETWEEN 3 AND 200 OR length(trim(p_body)) NOT BETWEEN 10 AND 6000 OR NOT EXISTS(SELECT 1 FROM program_modules WHERE module_id=p_module_id) THEN RAISE EXCEPTION 'invalid announcement' USING ERRCODE='22023'; END IF;
  INSERT INTO announcements(author_id,module_id,title,body,announcement_type,published_at,status)
    VALUES(p_user_id,p_module_id,trim(p_title),trim(p_body),'information',now(),'published') RETURNING id INTO announcement_id;
  INSERT INTO announcement_targets(announcement_id,program_id) SELECT announcement_id,pm.program_id FROM program_modules pm WHERE pm.module_id=p_module_id GROUP BY pm.program_id;
  RETURN jsonb_build_object('id',announcement_id);
END $$;

CREATE OR REPLACE FUNCTION public.campus_decide_role_request(p_admin_id uuid,p_request_id uuid,p_approve boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE req campus_role_requests%ROWTYPE; selected_role bigint;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM profiles p JOIN user_roles ur ON ur.user_id=p.id JOIN roles r ON r.id=ur.role_id WHERE p.id=p_admin_id AND p.account_status='active' AND r.code='admin') THEN RETURN jsonb_build_object('status','forbidden'); END IF;
  SELECT * INTO req FROM campus_role_requests WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND OR req.status<>'pending' THEN RETURN jsonb_build_object('status','closed'); END IF;
  IF p_approve THEN
    SELECT id INTO selected_role FROM roles WHERE code=req.requested_role;
    IF selected_role IS NULL THEN RETURN jsonb_build_object('status','missing_role'); END IF;
    INSERT INTO user_roles(user_id,role_id) VALUES(req.user_id,selected_role) ON CONFLICT DO NOTHING;
  END IF;
  UPDATE campus_role_requests SET status=CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,reviewed_by=p_admin_id,reviewed_at=now() WHERE id=req.id;
  RETURN jsonb_build_object('status','ok');
END $$;

CREATE OR REPLACE FUNCTION public.campus_marketplace_request(p_user_id uuid,p_listing_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE listing marketplace_listings%ROWTYPE; request_id uuid;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM profiles p JOIN user_roles ur ON ur.user_id=p.id JOIN roles r ON r.id=ur.role_id WHERE p.id=p_user_id AND p.account_status='active' AND r.code IN ('student','admin')) THEN RETURN jsonb_build_object('status','forbidden'); END IF;
  SELECT * INTO listing FROM marketplace_listings WHERE id=p_listing_id FOR UPDATE;
  IF NOT FOUND OR listing.status<>'available' OR listing.seller_id=p_user_id THEN RETURN jsonb_build_object('status','closed'); END IF;
  IF EXISTS(SELECT 1 FROM marketplace_transactions WHERE listing_id=p_listing_id AND requester_id=p_user_id AND status IN ('requested','accepted')) THEN RETURN jsonb_build_object('status','duplicate'); END IF;
  INSERT INTO marketplace_transactions(listing_id,requester_id,owner_id,transaction_type,status)
    VALUES(listing.id,p_user_id,listing.seller_id,listing.listing_type,'requested') RETURNING id INTO request_id;
  INSERT INTO notifications(user_id,title,body,notification_type,related_type,related_id)
    VALUES(listing.seller_id,'Nouvelle demande',listing.title,'marketplace','marketplace_listing',listing.id);
  RETURN jsonb_build_object('status','ok','id',request_id);
END $$;

CREATE OR REPLACE FUNCTION public.campus_marketplace_decide(p_user_id uuid,p_transaction_id uuid,p_status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE tx marketplace_transactions%ROWTYPE; listing marketplace_listings%ROWTYPE; listing_id uuid; administrator boolean;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM profiles WHERE id=p_user_id AND account_status='active') THEN RETURN jsonb_build_object('status','forbidden'); END IF;
  SELECT EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=p_user_id AND r.code='admin') INTO administrator;
  SELECT t.listing_id INTO listing_id FROM marketplace_transactions t WHERE t.id=p_transaction_id;
  IF listing_id IS NULL THEN RETURN jsonb_build_object('status','closed'); END IF;
  -- All marketplace mutations take the listing lock first, avoiding opposite lock orders.
  SELECT * INTO listing FROM marketplace_listings WHERE id=listing_id FOR UPDATE;
  SELECT * INTO tx FROM marketplace_transactions WHERE id=p_transaction_id FOR UPDATE;
  IF p_status='cancelled' THEN
    IF tx.requester_id<>p_user_id AND NOT administrator OR tx.status NOT IN ('requested','accepted') THEN RETURN jsonb_build_object('status','forbidden'); END IF;
    IF tx.status='accepted' AND listing.status='reserved' THEN UPDATE marketplace_listings SET status='available',updated_at=now() WHERE id=listing.id; END IF;
  ELSE
    IF tx.owner_id<>p_user_id AND NOT administrator THEN RETURN jsonb_build_object('status','forbidden'); END IF;
    IF p_status='accepted' THEN
      IF tx.status<>'requested' OR listing.status<>'available' THEN RETURN jsonb_build_object('status','closed'); END IF;
      UPDATE marketplace_listings SET status='reserved',updated_at=now() WHERE id=listing.id;
      UPDATE marketplace_transactions SET status='rejected',decided_at=now() WHERE marketplace_transactions.listing_id=listing.id AND id<>tx.id AND status='requested';
    ELSIF p_status='rejected' THEN
      IF tx.status<>'requested' THEN RETURN jsonb_build_object('status','closed'); END IF;
    ELSIF p_status='completed' THEN
      IF tx.status<>'accepted' OR listing.status<>'reserved' THEN RETURN jsonb_build_object('status','closed'); END IF;
      UPDATE marketplace_listings SET status='completed',closed_at=now(),updated_at=now() WHERE id=listing.id;
    ELSE RETURN jsonb_build_object('status','invalid'); END IF;
  END IF;
  UPDATE marketplace_transactions SET status=p_status::public.marketplace_transaction_status,decided_at=now(),completed_at=CASE WHEN p_status='completed' THEN now() ELSE NULL END WHERE id=tx.id;
  INSERT INTO notifications(user_id,title,body,notification_type,related_type,related_id)
    VALUES(CASE WHEN p_user_id=tx.requester_id THEN tx.owner_id ELSE tx.requester_id END,'Demande mise à jour',listing.title,'marketplace','marketplace_listing',listing.id);
  RETURN jsonb_build_object('status','ok');
END $$;

CREATE OR REPLACE FUNCTION public.campus_marketplace_close(p_user_id uuid,p_listing_id uuid,p_status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE listing marketplace_listings%ROWTYPE;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM profiles WHERE id=p_user_id AND account_status='active') THEN RETURN jsonb_build_object('status','forbidden'); END IF;
  SELECT * INTO listing FROM marketplace_listings WHERE id=p_listing_id FOR UPDATE;
  IF NOT FOUND OR listing.status NOT IN ('available','reserved') OR p_status NOT IN ('completed','withdrawn') THEN RETURN jsonb_build_object('status','closed'); END IF;
  IF listing.seller_id<>p_user_id AND NOT EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=p_user_id AND r.code='admin') THEN RETURN jsonb_build_object('status','forbidden'); END IF;
  UPDATE marketplace_listings SET status=p_status::public.marketplace_listing_status,closed_at=now(),updated_at=now() WHERE id=listing.id;
  UPDATE marketplace_transactions SET status=CASE WHEN p_status='completed' AND status='accepted' THEN 'completed'::public.marketplace_transaction_status ELSE 'cancelled'::public.marketplace_transaction_status END,decided_at=now(),completed_at=CASE WHEN p_status='completed' AND status='accepted' THEN now() ELSE NULL END WHERE listing_id=listing.id AND status IN ('requested','accepted');
  RETURN jsonb_build_object('status','ok');
END $$;

REVOKE ALL ON FUNCTION public.campus_publish_announcement(uuid,uuid,text,text),public.campus_decide_role_request(uuid,uuid,boolean),public.campus_marketplace_request(uuid,uuid),public.campus_marketplace_decide(uuid,uuid,text),public.campus_marketplace_close(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.campus_publish_announcement(uuid,uuid,text,text),public.campus_decide_role_request(uuid,uuid,boolean),public.campus_marketplace_request(uuid,uuid),public.campus_marketplace_decide(uuid,uuid,text),public.campus_marketplace_close(uuid,uuid,text) TO service_role;

-- Keep the upload bucket private; never change an existing bucket's configuration.
DO $$ BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
      VALUES('campus-files','campus-files',false,10485760,ARRAY['application/pdf','image/png','image/jpeg','image/webp'])
      ON CONFLICT(id) DO NOTHING;
  END IF;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
