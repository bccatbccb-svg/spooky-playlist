-- 🎃 Spooky Playlist — paste this whole file into Supabase → SQL Editor → Run.
-- Then change the DJ key on the last line to your own secret word.

create table if not exists settings (id int primary key default 1, dj_key text not null);

create table if not exists songs (
  id uuid primary key default gen_random_uuid(),
  canonical_key text unique not null,
  title text not null,
  artist text,
  artwork text,
  platform text,
  source_url text,
  links jsonb default '{}'::jsonb,
  spotify_uri text,
  free_download text,
  bpm numeric,
  camelot text,
  status text not null default 'approved' check (status in ('approved','pending','graveyard')),
  is_wildcard boolean default false,
  submitted_by_name text,
  submitted_by_device text,
  set_position int,
  sc_liked boolean default false,
  spotify_synced boolean default false,
  created_at timestamptz default now()
);

create table if not exists votes (
  song_id uuid references songs(id) on delete cascade,
  device_id text not null,
  name text,
  kind text default 'vote',
  created_at timestamptz default now(),
  primary key (song_id, device_id)
);

alter table settings enable row level security;
alter table songs enable row level security;
alter table votes enable row level security;
drop policy if exists "read songs" on songs;
drop policy if exists "read votes" on votes;
create policy "read songs" on songs for select using (true);
create policy "read votes" on votes for select using (true);
-- (no write policies: all writes go through the functions below)

-- Guest: submit a song. 5 go straight in, 6-8 are wildcards, then stop.
create or replace function submit_song(p_device text, p_name text, p_song jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_status text; v_count int; v_wild boolean;
begin
  if coalesce(trim(p_name),'') = '' then raise exception 'Tell us your name first'; end if;
  select id, status into v_id, v_status from songs where canonical_key = p_song->>'canonical_key';
  if v_id is not null then
    insert into votes(song_id, device_id, name, kind) values (v_id, p_device, p_name, 'vote') on conflict do nothing;
    return jsonb_build_object('result','duplicate','id',v_id,'status',v_status);
  end if;
  select count(*) into v_count from songs where submitted_by_device = p_device;
  if v_count >= 8 then raise exception 'You''ve used all 8 summons'; end if;
  v_wild := v_count >= 5;
  insert into songs(canonical_key,title,artist,artwork,platform,source_url,links,spotify_uri,free_download,
                    status,is_wildcard,submitted_by_name,submitted_by_device)
  values (p_song->>'canonical_key', p_song->>'title', p_song->>'artist', p_song->>'artwork', p_song->>'platform',
          p_song->>'source_url', coalesce(p_song->'links','{}'::jsonb), nullif(p_song->>'spotify_uri',''),
          nullif(p_song->>'free_download',''),
          case when v_wild then 'pending' else 'approved' end, v_wild, trim(p_name), p_device)
  returning id into v_id;
  insert into votes(song_id, device_id, name, kind) values (v_id, p_device, trim(p_name), 'submit');
  return jsonb_build_object('result', case when v_wild then 'wildcard' else 'added' end, 'id', v_id);
end $$;

-- Guest: upvote / un-upvote
create or replace function toggle_vote(p_device text, p_name text, p_song uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from votes where song_id = p_song and device_id = p_device) then
    delete from votes where song_id = p_song and device_id = p_device and kind = 'vote';
    return false;
  end if;
  insert into votes(song_id, device_id, name, kind) values (p_song, p_device, p_name, 'vote');
  return true;
end $$;

-- DJ: check secret key
create or replace function dj_check(p_key text) returns boolean
language sql security definer set search_path = public as $$
  select exists (select 1 from settings where dj_key = p_key);
$$;

-- DJ: update a song (status, bpm, key, liked, synced...)
create or replace function dj_update(p_key text, p_id uuid, p_fields jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not dj_check(p_key) then raise exception 'Not the DJ'; end if;
  update songs set
    status         = coalesce(p_fields->>'status', status),
    bpm            = case when p_fields ? 'bpm' then nullif(p_fields->>'bpm','')::numeric else bpm end,
    camelot        = case when p_fields ? 'camelot' then nullif(p_fields->>'camelot','') else camelot end,
    sc_liked       = coalesce((p_fields->>'sc_liked')::boolean, sc_liked),
    spotify_synced = coalesce((p_fields->>'spotify_synced')::boolean, spotify_synced),
    spotify_uri    = case when p_fields ? 'spotify_uri' then nullif(p_fields->>'spotify_uri','') else spotify_uri end
  where id = p_id;
end $$;

-- DJ: save set order
create or replace function dj_set_order(p_key text, p_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not dj_check(p_key) then raise exception 'Not the DJ'; end if;
  update songs s set set_position = o.pos
  from unnest(p_ids) with ordinality as o(id, pos) where s.id = o.id;
end $$;

grant execute on function submit_song, toggle_vote, dj_check, dj_update, dj_set_order to anon;

alter publication supabase_realtime add table songs, votes;

-- Safety: size limits + no direct writes (everything goes through the functions above)
alter table songs drop constraint if exists songs_sizes;
alter table songs add constraint songs_sizes check (
  length(title) between 1 and 300 and length(coalesce(artist,'')) <= 300
  and length(canonical_key) <= 700 and length(coalesce(artwork,'')) <= 1000
  and length(coalesce(source_url,'')) <= 1000 and length(coalesce(free_download,'')) <= 1000
  and length(links::text) <= 5000 and length(coalesce(submitted_by_name,'')) <= 60
  and length(coalesce(submitted_by_device,'')) <= 100 and length(coalesce(platform,'')) <= 30);
alter table votes drop constraint if exists votes_sizes;
alter table votes add constraint votes_sizes check (length(coalesce(name,'')) <= 60 and length(device_id) <= 100);
revoke insert, update, delete on songs, votes, settings from anon, authenticated;
revoke all on settings from anon, authenticated;

-- 👇 CHANGE THIS to your secret DJ word (it goes in your DJ link: dj.html?key=YOUR-WORD)
insert into settings (id, dj_key) values (1, 'change-me-pumpkin')
on conflict (id) do update set dj_key = excluded.dj_key;
