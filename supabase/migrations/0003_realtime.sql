-- Enable Realtime change feeds for the public, per-room tables only.
alter publication supabase_realtime add table public.rooms;
alter publication supabase_realtime add table public.members;
alter publication supabase_realtime add table public.queue_items;
