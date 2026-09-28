-- 0055 — Danh sách đen (owner, 2026-09-28): tài khoản trong danh sách vẫn vào game, chơi, chat bình thường, nhưng
-- MỌI lần được cộng xu (bán cá/cua/ốc/lúa, thắng bài, cược, thưởng, điểm danh, hoàn tiền…) chỉ được +1 xu. Tiền bị
-- trừ (mua, thua cược…) vẫn trừ đủ. Chặn ở tầng bảng: trigger trên wallets (số dư) và coin_ledger (sổ cái), nên mọi
-- hàm cũ lẫn mới đều theo mà không phải sửa từng hàm. Độc lập với v20 — chạy lúc nào cũng được.
--
-- Thêm / bỏ người (SQL Editor):
--   insert into public.blacklisted_accounts (account_id, note) values ('<uuid>', 'lý do') on conflict do nothing;
--   delete from public.blacklisted_accounts where account_id = '<uuid>';

create table if not exists public.blacklisted_accounts (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  note text,
  created_at timestamptz not null default now()
);
alter table public.blacklisted_accounts enable row level security;   -- không policy: trình duyệt không đọc/ghi được
revoke all on public.blacklisted_accounts from anon, authenticated;

create or replace function public._is_blacklisted(p_account uuid) returns boolean
language sql stable security definer set search_path = public, extensions
as $$ select exists (select 1 from public.blacklisted_accounts where account_id = p_account) $$;
revoke all on function public._is_blacklisted(uuid) from public, anon, authenticated;

-- Ví: một lần cộng của người trong danh sách đen chỉ được +1 (ví mới tạo cũng chỉ được tối đa 1 xu).
create or replace function public._wallet_blacklist_cap() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if public._is_blacklisted(new.account_id) then
    if tg_op = 'INSERT' then
      new.coins := least(new.coins, 1);
    elsif new.coins > old.coins then
      new.coins := old.coins + 1;
    end if;
  end if;
  return new;
end $$;
revoke all on function public._wallet_blacklist_cap() from public, anon, authenticated;
drop trigger if exists wallets_blacklist_cap on public.wallets;
create trigger wallets_blacklist_cap before insert or update of coins on public.wallets
  for each row execute function public._wallet_blacklist_cap();

-- Sổ cái: dòng cộng tiền ghi đúng +1 và số dư thật của ví (để lịch sử khớp với ví).
create or replace function public._ledger_blacklist_cap() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if new.delta > 0 and public._is_blacklisted(new.account_id) then
    new.delta := 1;
    new.balance := coalesce((select coins from public.wallets where account_id = new.account_id), new.balance);
  end if;
  return new;
end $$;
revoke all on function public._ledger_blacklist_cap() from public, anon, authenticated;
drop trigger if exists coin_ledger_blacklist_cap on public.coin_ledger;
create trigger coin_ledger_blacklist_cap before insert on public.coin_ledger
  for each row execute function public._ledger_blacklist_cap();

-- Người đầu tiên (owner yêu cầu 2026-09-28)
insert into public.blacklisted_accounts (account_id, note)
select 'f730b944-1b29-4f0d-b196-850b822d1688'::uuid, 'owner 2026-09-28: mọi thu nhập chỉ +1 xu'
where exists (select 1 from public.accounts where id = 'f730b944-1b29-4f0d-b196-850b822d1688')
on conflict (account_id) do nothing;
