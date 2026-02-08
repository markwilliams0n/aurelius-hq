-- Add 'capability:code' to config_key enum
ALTER TYPE config_key ADD VALUE IF NOT EXISTS 'capability:code';

-- Add 'code' to card_pattern enum
ALTER TYPE card_pattern ADD VALUE IF NOT EXISTS 'code';
