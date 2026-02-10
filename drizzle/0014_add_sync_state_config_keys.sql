-- Add sync state config keys to store connector sync state in the database
-- instead of dotfiles on disk.
ALTER TYPE config_key ADD VALUE IF NOT EXISTS 'sync:gmail';
ALTER TYPE config_key ADD VALUE IF NOT EXISTS 'sync:granola';
ALTER TYPE config_key ADD VALUE IF NOT EXISTS 'sync:linear';
ALTER TYPE config_key ADD VALUE IF NOT EXISTS 'sync:slack';
