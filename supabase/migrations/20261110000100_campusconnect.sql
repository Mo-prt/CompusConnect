-- Run once in the Supabase SQL Editor, or apply with `supabase db push`.
-- This schema preserves CampusConnect's existing custom authentication.
BEGIN;

CREATE TABLE public.users (
  id text PRIMARY KEY,
  email text NOT NULL,
  name text NOT NULL,
  password_hash text,
  salt text,
  program text NOT NULL,
  semester text NOT NULL,
  role text NOT NULL CHECK (role IN ('student','teacher','organizer')),
  scope text NOT NULL,
  demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (email, scope)
);
CREATE TABLE public.sessions (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  expires_at bigint NOT NULL
);
CREATE TABLE public.events (
  id text PRIMARY KEY,
  scope text NOT NULL,
  owner_id text NOT NULL,
  title text NOT NULL,
  category text NOT NULL CHECK (category IN ('Conférence','Atelier','Compétition','Vie associative')),
  date date NOT NULL,
  time text NOT NULL CHECK (time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  end_time text NOT NULL CHECK (end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND end_time > time),
  location text NOT NULL,
  organizer text NOT NULL,
  capacity integer NOT NULL CHECK (capacity BETWEEN 1 AND 10000),
  program text NOT NULL,
  image text NOT NULL,
  description text NOT NULL,
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('published','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.registrations (
  event_id text NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id)
);
CREATE TABLE public.auth_attempts (
  key text PRIMARY KEY,
  attempts integer NOT NULL DEFAULT 0,
  window_start bigint NOT NULL
);
CREATE INDEX events_scope_date ON public.events(scope,date,time);
CREATE INDEX sessions_expiry ON public.sessions(expires_at);
CREATE INDEX registrations_user ON public.registrations(user_id);

-- Every Data API operation is mediated by our backend, never the browser key.
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.users,public.sessions,public.events,public.registrations,public.auth_attempts FROM anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.users,public.sessions,public.events,public.registrations,public.auth_attempts TO service_role;

CREATE FUNCTION public.campus_session_user(p_hash text,p_now bigint)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT to_jsonb(u) FROM public.sessions s JOIN public.users u ON u.id=s.user_id
  WHERE s.token_hash=p_hash AND s.expires_at>p_now;
$$;

CREATE FUNCTION public.campus_auth_attempt(p_key text,p_now bigint)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE result integer;
BEGIN
  INSERT INTO public.auth_attempts AS a(key,attempts,window_start) VALUES(p_key,1,p_now)
  ON CONFLICT(key) DO UPDATE SET
    attempts=CASE WHEN a.window_start<p_now-900000 THEN 1 ELSE a.attempts+1 END,
    window_start=CASE WHEN a.window_start<p_now-900000 THEN p_now ELSE a.window_start END
  RETURNING attempts INTO result;
  RETURN result;
END;
$$;

CREATE FUNCTION public.campus_list_events(p_scope text,p_user_id text)
RETURNS SETOF jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT to_jsonb(e) || jsonb_build_object(
    'registered',(SELECT count(*) FROM public.registrations r WHERE r.event_id=e.id),
    'joined',EXISTS(SELECT 1 FROM public.registrations r WHERE r.event_id=e.id AND r.user_id=p_user_id)
  ) FROM public.events e
  WHERE e.scope=p_scope AND (e.status='published' OR e.owner_id=p_user_id)
  ORDER BY e.date,e.time;
$$;

CREATE FUNCTION public.campus_get_event(p_id text,p_scope text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT to_jsonb(e) || jsonb_build_object(
    'registered',(SELECT count(*) FROM public.registrations r WHERE r.event_id=e.id)
  ) FROM public.events e WHERE e.id=p_id AND e.scope=p_scope;
$$;

CREATE FUNCTION public.campus_participants(p_event_id text,p_user_id text,p_scope text)
RETURNS SETOF jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT jsonb_build_object('name',u.name,'email',u.email,'program',u.program,'created_at',r.created_at)
  FROM public.registrations r JOIN public.users u ON u.id=r.user_id
  WHERE r.event_id=p_event_id AND EXISTS(
    SELECT 1 FROM public.events e WHERE e.id=r.event_id AND e.scope=p_scope AND e.owner_id=p_user_id
  ) ORDER BY r.created_at;
$$;

-- Row locking serializes enrollments and capacity changes for the same event.
CREATE FUNCTION public.campus_register(p_event_id text,p_user_id text,p_scope text)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE ev public.events; actor public.users; inserted integer;
BEGIN
  SELECT * INTO ev FROM public.events WHERE id=p_event_id AND scope=p_scope FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF ev.status<>'published' OR ((ev.date+ev.time::time) AT TIME ZONE 'Africa/Casablanca')<=clock_timestamp()
  THEN RETURN 'closed'; END IF;
  SELECT * INTO actor FROM public.users WHERE id=p_user_id AND scope=p_scope AND role='student';
  IF NOT FOUND OR (ev.program<>'Toutes' AND ev.program<>actor.program) THEN RETURN 'forbidden'; END IF;
  IF (SELECT count(*) FROM public.registrations WHERE event_id=p_event_id)>=ev.capacity THEN RETURN 'full'; END IF;
  INSERT INTO public.registrations(event_id,user_id) VALUES(p_event_id,p_user_id) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS inserted=ROW_COUNT;
  IF inserted=0 THEN RETURN 'duplicate'; END IF;
  RETURN 'ok';
END;
$$;

CREATE FUNCTION public.campus_update_event(p_id text,p_user_id text,p_scope text,p_event jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE ev public.events; new_capacity integer;
BEGIN
  SELECT * INTO ev FROM public.events WHERE id=p_id AND scope=p_scope AND owner_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  new_capacity=(p_event->>'capacity')::integer;
  IF new_capacity IS NULL OR new_capacity<(SELECT count(*) FROM public.registrations WHERE event_id=p_id)
  THEN RETURN false; END IF;
  UPDATE public.events SET
    title=p_event->>'title',category=p_event->>'category',date=(p_event->>'date')::date,
    time=p_event->>'time',end_time=p_event->>'end_time',location=p_event->>'location',
    organizer=p_event->>'organizer',capacity=new_capacity,program=p_event->>'program',
    image=p_event->>'image',description=p_event->>'description'
  WHERE id=p_id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.campus_session_user(text,bigint),public.campus_auth_attempt(text,bigint),
  public.campus_list_events(text,text),public.campus_get_event(text,text),public.campus_participants(text,text,text),
  public.campus_register(text,text,text),public.campus_update_event(text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.campus_session_user(text,bigint),public.campus_auth_attempt(text,bigint),
  public.campus_list_events(text,text),public.campus_get_event(text,text),public.campus_participants(text,text,text),
  public.campus_register(text,text,text),public.campus_update_event(text,text,text,jsonb) TO service_role;

COMMIT;
