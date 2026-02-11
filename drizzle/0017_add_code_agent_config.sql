-- Add capability:code-agent config key for autonomous code agent settings
ALTER TYPE config_key ADD VALUE IF NOT EXISTS 'capability:code-agent';
