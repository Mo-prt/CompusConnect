-- Compatibility layer for the ALREADY EXISTING CampusConnect Supabase schema.
-- No application tables, records, policies or enums are removed/replaced.
BEGIN;
DO $$
BEGIN
  IF to_regclass('public.profiles') IS NULL OR to_regclass('public.user_roles') IS NULL
     OR to_regclass('public.events') IS NULL OR to_regclass('public.event_registrations') IS NULL
     OR to_regclass('public.event_program_targets') IS NULL THEN
    RAISE EXCEPTION 'Install the existing CampusConnect relational schema before this compatibility layer.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.campus_existing_ensure_profile(
  p_user_id uuid,p_program_id uuid,p_first_name text,p_last_name text,p_email text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE department uuid; actor public.profiles; student_role bigint;
BEGIN
  SELECT department_id INTO department FROM public.programs WHERE id=p_program_id AND is_active;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','forbidden'); END IF;
  INSERT INTO public.profiles(id,program_id,department_id,first_name,last_name,email)
  VALUES(p_user_id,p_program_id,department,p_first_name,p_last_name,p_email)
  ON CONFLICT(id) DO NOTHING;
  SELECT * INTO actor FROM public.profiles WHERE id=p_user_id FOR UPDATE;
  IF actor.account_status<>'active' THEN RETURN jsonb_build_object('status','forbidden'); END IF;
  -- A caller can only receive the default student role, never an elevated role.
  IF NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p_user_id) THEN
    SELECT id INTO student_role FROM public.roles WHERE code='student';
    IF student_role IS NULL THEN RAISE EXCEPTION 'The student role is missing.'; END IF;
    INSERT INTO public.user_roles(user_id,role_id) VALUES(p_user_id,student_role) ON CONFLICT DO NOTHING;
  END IF;
  RETURN jsonb_build_object('status','ok');
END;
$$;

CREATE OR REPLACE FUNCTION public.campus_existing_save_event(
  p_user_id uuid,p_event_id uuid,p_event jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE ev public.events; result_id uuid; target uuid; total_targets integer; new_capacity integer; admin_role boolean;
BEGIN
  SELECT EXISTS(SELECT 1 FROM public.user_roles ur JOIN public.roles r ON r.id=ur.role_id WHERE ur.user_id=p_user_id AND r.code='admin') INTO admin_role;
  IF NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=p_user_id AND p.account_status='active') OR
     NOT EXISTS(SELECT 1 FROM public.user_roles ur JOIN public.roles r ON r.id=ur.role_id WHERE ur.user_id=p_user_id AND r.code IN ('organizer','admin'))
  THEN RETURN jsonb_build_object('status','forbidden'); END IF;
  IF COALESCE(p_event->>'status','published') NOT IN ('draft','published') THEN RETURN jsonb_build_object('status','forbidden'); END IF;
  new_capacity=(p_event->>'capacity')::integer;
  IF new_capacity IS NOT NULL AND (new_capacity<1 OR new_capacity>10000) THEN RETURN jsonb_build_object('status','capacity'); END IF;
  IF (p_event->>'starts_at')::timestamptz<=clock_timestamp() OR (p_event->>'ends_at')::timestamptz<=(p_event->>'starts_at')::timestamptz THEN
    RETURN jsonb_build_object('status','closed');
  END IF;
  SELECT count(*) INTO total_targets FROM jsonb_array_elements_text(p_event->'program_ids');
  IF total_targets<>(SELECT count(*) FROM public.programs WHERE is_active AND id IN (SELECT value::uuid FROM jsonb_array_elements_text(p_event->'program_ids'))) THEN
    RETURN jsonb_build_object('status','forbidden');
  END IF;
  IF p_event_id IS NULL THEN
    INSERT INTO public.events(organizer_id,title,description,category,starts_at,ends_at,location_text,capacity,status)
    VALUES(p_user_id,p_event->>'title',p_event->>'description',p_event->>'category',(p_event->>'starts_at')::timestamptz,(p_event->>'ends_at')::timestamptz,p_event->>'location_text',new_capacity,COALESCE(p_event->>'status','published')::public.event_status)
    RETURNING id INTO result_id;
  ELSE
    SELECT * INTO ev FROM public.events WHERE id=p_event_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('status','not_found'); END IF;
    IF ev.organizer_id<>p_user_id AND NOT admin_role THEN RETURN jsonb_build_object('status','forbidden'); END IF;
    IF new_capacity IS NOT NULL AND new_capacity<(SELECT count(*) FROM public.event_registrations WHERE event_id=p_event_id AND status IN ('registered','attended')) THEN
      RETURN jsonb_build_object('status','capacity');
    END IF;
    UPDATE public.events SET title=p_event->>'title',description=p_event->>'description',category=p_event->>'category',
      starts_at=(p_event->>'starts_at')::timestamptz,ends_at=(p_event->>'ends_at')::timestamptz,
      location_text=p_event->>'location_text',capacity=new_capacity,status=COALESCE(p_event->>'status','published')::public.event_status,updated_at=now()
    WHERE id=p_event_id;
    result_id=p_event_id;
    DELETE FROM public.event_program_targets WHERE event_id=result_id;
  END IF;
  FOR target IN SELECT value::uuid FROM jsonb_array_elements_text(p_event->'program_ids') LOOP
    INSERT INTO public.event_program_targets(event_id,program_id) VALUES(result_id,target);
  END LOOP;
  RETURN jsonb_build_object('status','ok','id',result_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.campus_existing_register(
  p_user_id uuid,p_event_id uuid,p_cancel boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE ev public.events; actor public.profiles; prior uuid;
BEGIN
  SELECT * INTO actor FROM public.profiles WHERE id=p_user_id AND account_status='active';
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.user_roles ur JOIN public.roles r ON r.id=ur.role_id WHERE ur.user_id=p_user_id AND r.code IN ('student','admin'))
  THEN RETURN jsonb_build_object('status','forbidden'); END IF;
  -- The same event row is locked by enrollment and capacity modification.
  SELECT * INTO ev FROM public.events WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','not_found'); END IF;
  IF ev.starts_at<=clock_timestamp() THEN RETURN jsonb_build_object('status','closed'); END IF;
  IF p_cancel THEN
    UPDATE public.event_registrations SET status='cancelled',cancelled_at=now()
    WHERE event_id=p_event_id AND student_id=p_user_id AND status IN ('registered','attended');
    RETURN jsonb_build_object('status','ok');
  END IF;
  IF ev.status<>'published' THEN RETURN jsonb_build_object('status','closed'); END IF;
  IF EXISTS(SELECT 1 FROM public.event_program_targets WHERE event_id=p_event_id)
    AND NOT EXISTS(SELECT 1 FROM public.event_program_targets WHERE event_id=p_event_id AND program_id=actor.program_id)
  THEN RETURN jsonb_build_object('status','forbidden'); END IF;
  IF EXISTS(SELECT 1 FROM public.event_registrations WHERE event_id=p_event_id AND student_id=p_user_id AND status IN ('registered','attended'))
  THEN RETURN jsonb_build_object('status','duplicate'); END IF;
  IF ev.capacity IS NOT NULL AND (SELECT count(*) FROM public.event_registrations WHERE event_id=p_event_id AND status IN ('registered','attended'))>=ev.capacity
  THEN RETURN jsonb_build_object('status','full'); END IF;
  SELECT id INTO prior FROM public.event_registrations WHERE event_id=p_event_id AND student_id=p_user_id AND status='cancelled' ORDER BY registered_at DESC,id DESC LIMIT 1;
  IF prior IS NULL THEN
    INSERT INTO public.event_registrations(event_id,student_id,status) VALUES(p_event_id,p_user_id,'registered');
  ELSE
    UPDATE public.event_registrations SET status='registered',registered_at=now(),cancelled_at=NULL WHERE id=prior;
  END IF;
  RETURN jsonb_build_object('status','ok');
END;
$$;

CREATE OR REPLACE FUNCTION public.campus_existing_cancel_event(p_user_id uuid,p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE ev public.events; admin_role boolean;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.profiles p JOIN public.user_roles ur ON ur.user_id=p.id JOIN public.roles r ON r.id=ur.role_id WHERE p.id=p_user_id AND p.account_status='active' AND r.code IN ('organizer','admin'))
  THEN RETURN jsonb_build_object('status','forbidden'); END IF;
  SELECT EXISTS(SELECT 1 FROM public.user_roles ur JOIN public.roles r ON r.id=ur.role_id WHERE ur.user_id=p_user_id AND r.code='admin') INTO admin_role;
  SELECT * INTO ev FROM public.events WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','not_found'); END IF;
  IF ev.organizer_id<>p_user_id AND NOT admin_role THEN RETURN jsonb_build_object('status','forbidden'); END IF;
  UPDATE public.events SET status='cancelled',updated_at=now() WHERE id=p_event_id;
  RETURN jsonb_build_object('status','ok');
END;
$$;

-- Existing RLS policies and table definitions are preserved.
GRANT SELECT ON public.profiles,public.roles,public.user_roles,public.programs,public.departments,public.department_heads,
  public.semesters,public.modules,public.program_modules,public.timetables,public.timetable_sessions,public.classrooms,
  public.events,public.event_program_targets,public.event_registrations TO service_role;
GRANT INSERT,UPDATE ON public.profiles,public.user_roles TO service_role;
GRANT INSERT,UPDATE ON public.events,public.event_registrations TO service_role;
GRANT INSERT,DELETE ON public.event_program_targets TO service_role;
REVOKE ALL ON FUNCTION public.campus_existing_ensure_profile(uuid,uuid,text,text,text),
  public.campus_existing_save_event(uuid,uuid,jsonb),public.campus_existing_register(uuid,uuid,boolean),
  public.campus_existing_cancel_event(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.campus_existing_ensure_profile(uuid,uuid,text,text,text),
  public.campus_existing_save_event(uuid,uuid,jsonb),public.campus_existing_register(uuid,uuid,boolean),
  public.campus_existing_cancel_event(uuid,uuid) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
