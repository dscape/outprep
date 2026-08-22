-- Preserve normalized source games with the all-time bot cache so filtered
-- opening books can be rebuilt without refetching the upstream provider.
ALTER TABLE bot_data_cache
  ADD COLUMN IF NOT EXISTS game_moves JSONB;
