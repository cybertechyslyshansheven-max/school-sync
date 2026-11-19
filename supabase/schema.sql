-- SchoolSync database schema. Run in Supabase: SQL Editor -> New query -> paste -> Run.
create extension if not exists pgcrypto;

-- Emails listed here become ADMIN when they sign up. Edit before/after running.
create table if not exists admin_emails (email text primary key);
insert into admin_emails(email) values ('your-admin@gmail.com') on conflict do nothing;

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null, email text not null, batch text default '2026–2027',
  role text not null default 'student' check (role in ('student','admin')),
  email_pref boolean not null default true,
  created_at timestamptz default now(), updated_at timestamptz default now());

create table if not exists classes (
  id uuid primary key, owner_id uuid not null references profiles(id) on delete cascade,
  day text not null, start_time text not null, end_time text not null, subject text not null, room text,
  created_at timestamptz default now(), updated_at timestamptz default now());

create table if not exists tasks (
  id uuid primary key, owner_id uuid not null references profiles(id) on delete cascade,
  title text not null, subject text, description text, due_at timestamptz,
  done boolean not null default false, completed_at timestamptz,
  created_at timestamptz default now(), updated_at timestamptz default now());

create table if not exists announcements (
  id uuid primary key, author_id uuid references profiles(id),
  title text not null, message text not null, category text default 'Important',
  date date default current_date, event_date date,
  notify_all boolean not null default true, recipient_ids jsonb not null default '[]',
  published boolean not null default true, notified_at timestamptz,
  created_at timestamptz default now(), updated_at timestamptz default now());

create table if not exists assignments (
  id uuid primary key, author_id uuid references profiles(id),
  title text not null, subject text, instructions text not null, due_at timestamptz,
  notify_all boolean not null default true, recipient_ids jsonb not null default '[]',
  published boolean not null default true, notified_at timestamptz,
  created_at timestamptz default now(), updated_at timestamptz default now());

create table if not exists event_reminders (
  id uuid primary key, author_id uuid references profiles(id),
  title text not null, description text, event_at timestamptz not null,
  notify_all boolean not null default true, recipient_ids jsonb not null default '[]',
  sent_at timestamptz,
  created_at timestamptz default now(), updated_at timestamptz default now());

create table if not exists notifications (
  id uuid primary key, user_id uuid not null references profiles(id) on delete cascade,
  type text, title text not null, body text, link text, ref_id uuid, read boolean not null default false,
  created_at timestamptz default now(), updated_at timestamptz default now());

create table if not exists email_logs (
  id uuid primary key default gen_random_uuid(), recipient_id uuid, recipient_email text,
  type text not null, ref_id uuid, dedupe_key text, status text not null, error text,
  created_at timestamptz default now(), updated_at timestamptz default now());
create index if not exists email_logs_dedupe on email_logs(dedupe_key);

-- helpers
create or replace function is_admin() returns boolean language sql stable security definer set search_path = public as
$$ select exists(select 1 from profiles where id = auth.uid() and role = 'admin') $$;

create or replace function handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles(id, name, email, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email,'@',1)), new.email,
          case when exists(select 1 from admin_emails a where lower(a.email) = lower(new.email)) then 'admin' else 'student' end);
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

-- users may never change their own role/email
create or replace function protect_profile() returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and not (auth.role() = 'service_role') then new.role := old.role; new.email := old.email; end if;
  return new;
end $$;
drop trigger if exists protect_profile_trg on profiles;
create trigger protect_profile_trg before update on profiles for each row execute function protect_profile();

-- Row Level Security
alter table admin_emails enable row level security;   -- no policies = inaccessible from the client
alter table profiles enable row level security;
alter table classes enable row level security;
alter table tasks enable row level security;
alter table announcements enable row level security;
alter table assignments enable row level security;
alter table event_reminders enable row level security;
alter table notifications enable row level security;
alter table email_logs enable row level security;

create policy profiles_read on profiles for select using (id = auth.uid() or is_admin());
create policy profiles_update on profiles for update using (id = auth.uid()) with check (id = auth.uid());

create policy classes_own on classes for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy tasks_own on tasks for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy ann_read on announcements for select using (is_admin() or (published and (notify_all or recipient_ids ? auth.uid()::text)));
create policy ann_write on announcements for all using (is_admin()) with check (is_admin());
create policy asg_read on assignments for select using (is_admin() or (published and (notify_all or recipient_ids ? auth.uid()::text)));
create policy asg_write on assignments for all using (is_admin()) with check (is_admin());
create policy rem_admin on event_reminders for all using (is_admin()) with check (is_admin());

create policy notif_read on notifications for select using (user_id = auth.uid());
create policy notif_update on notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notif_delete on notifications for delete using (user_id = auth.uid());
create policy notif_insert on notifications for insert with check (is_admin());

create policy logs_admin_read on email_logs for select using (is_admin());
-- email_logs are written only by the Netlify functions (service role key bypasses RLS).
