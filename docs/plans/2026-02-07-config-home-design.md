# Config Home: Neural Map — Design

> PER-175 | Branch: `feature/config-home`

## Overview

A `/config` page that visualizes Aurelius as a force-directed neural map. Shows all capabilities, connectors, configs, and their data flow connections. Serves three roles: monitoring (what's healthy), configuring (editing configs/prompts), and understanding (how systems connect).

## Layout

```
┌──────────────────────────────────────────────────────────┐
│                    Neural Map (80%)           │ Detail   │
│                                               │ Panel    │
│          [force-directed graph]                │ (20%)    │
│          zoom / pan / click                   │ slides   │
│                                               │ in on    │
│                                               │ click    │
├──────────────────────────────────────────────────────────┤
│  Activity Ticker (bottom strip)                          │
│  ← tool_call:slack  config_change:soul  connector_sync → │
└──────────────────────────────────────────────────────────┘
```

## Node Types

| Type | Examples | Size | Data Source |
|------|----------|------|-------------|
| Core | AI Client, Memory, Config, Triage | Large | Hardcoded |
| Capability | Tasks, Config, Slack | Medium | `capabilities/` + DB |
| Connector | Gmail, Slack, Linear, Granola | Medium | Heartbeat connectors |
| Config | soul, system_prompt, capability:* | Small | `configKeyEnum` |

## Edge Visual Language

| Flow Type | Color | Example |
|-----------|-------|---------|
| Ingest | Blue | Slack → Triage |
| AI/Processing | Purple | AI Client → OpenRouter |
| Action | Amber/Gold | Slack capability → send message |
| Config | Green | System reading its config |

- **Animated**: edges pulse on recent activity
- **Thickness**: encodes 24h volume
- **Dim/bright**: idle vs active

## Node Indicators

- Pulse ring: active in last few minutes
- Status dot: green (healthy), yellow (stale), red (error)
- Activity badge: event count today

## Detail Panel (right)

Slides in on node click. Header: name, status, 7-day sparkline.

**Connector nodes**: last sync, items today, errors, link to triage
**Capability nodes**: prompt (editable), tool list with call counts
**Config nodes**: current value (markdown), click-to-edit, version history
**Core nodes**: key stats, recent events, links to related pages

## Data Model

### New table: `system_events`

```sql
id          uuid
event_type  'tool_call' | 'connector_sync' | 'config_change' | 'capability_use'
source      text (e.g. 'connector:slack')
target      text (optional)
metadata    jsonb
created_at  timestamp
```

### New API: `GET /api/config/topology`

Returns nodes, edges, and recent events. Semi-static topology with live stats computed from `system_events` + existing tables. Polled every 30s.

## Tech

- **React Flow** for graph rendering
- Custom React components for nodes (match app aesthetic)
- Dark background for visual pop
- Polling refresh (no WebSocket for v1)

## v1 Scope

**Build**: page, hardcoded topology, detail panel, system_events table, instrumentation, animated edges, ticker, topology API
**Skip**: capability toggles, cost tracking, version diffs, WebSocket
