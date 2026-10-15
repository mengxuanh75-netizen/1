-- First enable pg_cron in Supabase Dashboard > Database > Extensions.
-- Run as administrator after schema.sql. Safe to rerun, preserving other jobs.
do $$
declare existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname='closer-room-cleanup';
  if found then perform cron.unschedule(existing_job); end if;
end;
$$;
select cron.schedule('closer-room-cleanup','*/10 * * * *','select public.cleanup_expired_rooms()');
-- Expired rooms become inaccessible immediately. Physical deletion follows within
-- ten minutes when this job is installed. Database/provider backups are separate.
