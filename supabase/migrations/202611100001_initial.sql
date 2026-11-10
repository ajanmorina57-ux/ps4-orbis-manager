create extension if not exists pgcrypto;

create table if not exists public.packages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  file_name text not null check (char_length(file_name) between 1 and 180),
  object_key text not null unique,
  size_bytes bigint not null check (size_bytes > 0),
  sha256 text check (sha256 is null or sha256 ~ '^[a-fA-F0-9]{64}$'),
  status text not null default 'uploading' check (status in ('uploading', 'ready', 'failed')),
  title_id text,
  content_id text,
  version text,
  import_job_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists packages_user_created_idx on public.packages (user_id, created_at desc);
create index if not exists packages_user_status_idx on public.packages (user_id, status);

create table if not exists public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  file_name text not null check (char_length(file_name) between 1 and 180),
  source_url text not null check (char_length(source_url) <= 4096),
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed')),
  progress_bytes bigint not null default 0 check (progress_bytes >= 0),
  total_bytes bigint check (total_bytes is null or total_bytes >= 0),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  lease_until timestamptz,
  error_code text,
  package_id uuid references public.packages(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists import_jobs_user_created_idx on public.import_jobs (user_id, created_at desc);
create index if not exists import_jobs_claim_idx on public.import_jobs (status, available_at, lease_until, created_at);

alter table public.packages enable row level security;
alter table public.import_jobs enable row level security;

drop policy if exists "owners read packages" on public.packages;
create policy "owners read packages" on public.packages for select to authenticated using (auth.uid() = user_id);
drop policy if exists "owners insert packages" on public.packages;
drop policy if exists "owners update packages" on public.packages;
drop policy if exists "owners delete packages" on public.packages;
-- All package mutations go through the authenticated API, which enforces the
-- user's identity and generates a server-owned R2 key before using service_role.
revoke all on public.packages from public, anon, authenticated;
grant select (id, user_id, file_name, size_bytes, sha256, status, title_id, content_id, version, created_at, updated_at)
  on public.packages to authenticated;

drop policy if exists "owners read import jobs" on public.import_jobs;
create policy "owners read import jobs" on public.import_jobs for select to authenticated using (auth.uid() = user_id);
drop policy if exists "owners create import jobs" on public.import_jobs;
revoke all on public.import_jobs from public, anon, authenticated;
grant select (id, user_id, file_name, status, progress_bytes, total_bytes, error_code, package_id, created_at, updated_at)
  on public.import_jobs to authenticated;

create or replace function public.claim_import_job(lease_seconds integer default 180)
returns setof public.import_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed public.import_jobs;
begin
  select * into claimed
  from public.import_jobs
  where attempts < 3
    and available_at <= now()
    and (status = 'queued' or (status = 'running' and lease_until < now()))
  order by created_at
  for update skip locked
  limit 1;

  if not found then
    return;
  end if;

  update public.import_jobs
  set status = 'running',
      attempts = attempts + 1,
      lease_until = now() + make_interval(secs => greatest(lease_seconds, 30)),
      updated_at = now()
  where id = claimed.id
  returning * into claimed;

  return next claimed;
end;
$$;

revoke all on function public.claim_import_job(integer) from public, anon, authenticated;
grant execute on function public.claim_import_job(integer) to service_role;

comment on column public.packages.object_key is 'Private Cloudflare R2 object key; never return to browser clients.';
comment on column public.import_jobs.source_url is 'Private source URL; never log this value.';
