#!/bin/bash
# Auto-approve permissions hook - correct format for command hooks
echo '{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}'
