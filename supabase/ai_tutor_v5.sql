-- =====================================================================
-- ExamenMate · Profesor Virtual — completare v5
-- Notificări extinse:
--   • ai_broadcasts        → anunțuri către TOȚI (materiale noi, forum, update-uri)
--   • ai_broadcast_reads   → cine a citit fiecare anunț
--   • ai_mastery_snapshots → pentru a detecta evoluție / scădere la elevi
--   • discussion_likes     → like-uri (backend); declanșează notificare autorului
-- Rulează DUPĂ v1–v4. Idempotent.
-- =====================================================================

-- 1) ANUNȚURI GLOBALE ---------------------------------------------------------
create table if not exists public.ai_broadcasts (
  id         uuid primary key default gen_random_uuid(),
  type       text not null default 'info',   -- 'material' | 'forum' | 'update' | 'info'
  title      text not null,
  body       text,
  data       jsonb not null default '{}'::jsonb,  -- { url, category, contentType, ... }
  created_at timestamptz default now()
);
create index if not exists idx_aibroad_created on public.ai_broadcasts(created_at desc);

create table if not exists public.ai_broadcast_reads (
  broadcast_id uuid references public.ai_broadcasts(id) on delete cascade,
  user_id      uuid references auth.users(id) on delete cascade,
  read_at      timestamptz default now(),
  primary key (broadcast_id, user_id)
);

alter table public.ai_broadcasts enable row level security;
alter table public.ai_broadcast_reads enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='ai_broadcasts' and policyname='broad_read_all') then
    create policy "broad_read_all" on public.ai_broadcasts for select
      using (auth.role() = 'authenticated' or auth.role() = 'service_role');
  end if;
  if not exists (select 1 from pg_policies where tablename='ai_broadcasts' and policyname='broad_service_insert') then
    create policy "broad_service_insert" on public.ai_broadcasts for insert
      with check (auth.role() = 'service_role');
  end if;
  -- read-markers: fiecare își gestionează propriile marcaje
  if not exists (select 1 from pg_policies where tablename='ai_broadcast_reads' and policyname='bread_own') then
    create policy "bread_own" on public.ai_broadcast_reads for all
      using (auth.uid() = user_id or auth.role() = 'service_role')
      with check (auth.uid() = user_id or auth.role() = 'service_role');
  end if;
end $$;

-- 2) SNAPSHOT PROGRES (pentru evoluție / scădere) -----------------------------
create table if not exists public.ai_mastery_snapshots (
  user_id    uuid references auth.users(id) on delete cascade,
  topic      text,
  category   text,
  mastery    numeric not null,
  updated_at timestamptz default now(),
  primary key (user_id, topic)
);
alter table public.ai_mastery_snapshots enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='ai_mastery_snapshots' and policyname='snap_service') then
    create policy "snap_service" on public.ai_mastery_snapshots for all
      using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
  end if;
end $$;

-- 3) LIKE-URI la postările din forum ------------------------------------------
create table if not exists public.discussion_likes (
  id            uuid primary key default gen_random_uuid(),
  discussion_id uuid references public.discussions(id) on delete cascade not null,
  user_id       uuid references auth.users(id) on delete cascade not null,
  created_at    timestamptz default now(),
  unique (discussion_id, user_id)
);
create index if not exists idx_disclike_disc on public.discussion_likes(discussion_id);
alter table public.discussion_likes enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='discussion_likes' and policyname='dislike_read') then
    create policy "dislike_read" on public.discussion_likes for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='discussion_likes' and policyname='dislike_own_write') then
    create policy "dislike_own_write" on public.discussion_likes for all
      using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
end $$;

-- 4) URL pentru un material (după tip) ----------------------------------------
create or replace function public.ai_material_url(p_id uuid, p_type text, p_category text)
returns text language sql immutable as $$
  select case
    when p_type = 'pdf' then '/pdf-viewer?id=' || p_id::text
    when p_type = 'interactive' then '/exercitiu?id=' || p_id::text
    when p_type = 'manual' then '/manuale'
    when p_category like 'clasa-%' then '/clase/' || replace(p_category, 'clasa-', '')
    when p_category = 'evaluare-nationala' then '/evaluare-nationala'
    when p_category = 'bacalaureat' then '/bacalaureat'
    when p_category = 'manuale' then '/manuale'
    else '/'
  end;
$$;

create or replace function public.ai_category_label(p_category text)
returns text language sql immutable as $$
  select case
    when p_category like 'clasa-%' then 'clasa a ' || replace(p_category, 'clasa-', '') || '-a'
    when p_category = 'evaluare-nationala' then 'Evaluare Națională'
    when p_category = 'bacalaureat' then 'Bacalaureat'
    when p_category = 'manuale' then 'Manuale'
    else coalesce(p_category, 'general')
  end;
$$;

-- 5) TRIGGER: material nou → anunț global -------------------------------------
create or replace function public.notify_new_content()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  type_label text;
begin
  type_label := case new.content_type
    when 'pdf' then 'PDF nou'
    when 'interactive' then 'Exercițiu interactiv nou'
    when 'manual' then 'Manual nou'
    else 'Material nou' end;
  insert into public.ai_broadcasts (type, title, body, data)
  values (
    'material',
    type_label || ' · ' || public.ai_category_label(new.category),
    coalesce(new.title, 'Material nou') ,
    jsonb_build_object(
      'url', public.ai_material_url(new.id, new.content_type, new.category),
      'category', new.category, 'contentType', new.content_type, 'contentId', new.id, 'isFree', new.is_free
    )
  );
  return new;
end $$;

drop trigger if exists trg_notify_new_content on public.content;
create trigger trg_notify_new_content after insert on public.content
  for each row execute function public.notify_new_content();

-- 6) TRIGGER: postare/răspuns în forum ----------------------------------------
create or replace function public.notify_new_discussion()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  parent_author uuid;
  liker_name text;
begin
  if new.parent_id is not null then
    -- răspuns la o postare → notifică autorul postării-părinte
    select user_id into parent_author from public.discussions where id = new.parent_id;
    if parent_author is not null and parent_author <> new.user_id then
      insert into public.ai_notifications (recipient_id, type, title, body, data)
      values (parent_author, 'forum_reply', 'Cineva ți-a răspuns pe forum',
              left(coalesce(new.body, ''), 120),
              jsonb_build_object('url', '/discutii', 'discussionId', new.id));
    end if;
  else
    -- postare nouă de nivel înalt → anunț general
    insert into public.ai_broadcasts (type, title, body, data)
    values ('forum', 'Discuție nouă pe forum', left(coalesce(new.body, ''), 120),
            jsonb_build_object('url', '/discutii', 'discussionId', new.id));
  end if;
  return new;
end $$;

drop trigger if exists trg_notify_new_discussion on public.discussions;
create trigger trg_notify_new_discussion after insert on public.discussions
  for each row execute function public.notify_new_discussion();

-- 7) TRIGGER: like nou → notifică autorul postării ----------------------------
create or replace function public.notify_new_like()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  post_author uuid;
begin
  select user_id into post_author from public.discussions where id = new.discussion_id;
  if post_author is not null and post_author <> new.user_id then
    insert into public.ai_notifications (recipient_id, type, title, body, data, dedupe_key)
    values (post_author, 'like', 'Cuiva i-a plăcut postarea ta', null,
            jsonb_build_object('url', '/discutii', 'discussionId', new.discussion_id),
            'like:' || new.discussion_id::text || ':' || new.user_id::text);
  end if;
  return new;
end $$;

drop trigger if exists trg_notify_new_like on public.discussion_likes;
create trigger trg_notify_new_like after insert on public.discussion_likes
  for each row execute function public.notify_new_like();
