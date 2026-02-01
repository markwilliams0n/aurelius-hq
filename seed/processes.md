# Processes

## Connector Sync

Polls connected services for new items.

schedule: "*/1 * * * *"
enabled: true

## Heartbeat

Extracts facts from recent triage activity.

schedule: "0 * * * *"
enabled: true

## Summary Regeneration

Refreshes entity summaries with latest facts.

schedule: "0 3 * * *"
enabled: true
