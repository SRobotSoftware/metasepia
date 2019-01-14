# Metasepia

A chatbot for the DopefishLives online streaming community.

---

## Goals:

* Parse and track topic changes
* Provide an accessible API of changes and derived stats
* ???

---

## Design Considerations


### Data
sessions:
session_id|streamer|start_timestamp|end_timestamp|raw_topic_string|fk_activities_mapping
---|---|---|---|---|---|---
0|skwid|dark souls|SQL_TIMESTAMP|SQL_TIMESTAMP|'Streamer: Skwid \| Game: Dark Souls \| #dopefish_gdq'|0
1|mcskwid|dark souls 2|SQL_TIMESTAMP|SQL_TIMESTAMP|'Streamer: McSkwid \| Gaem: Dark Souls 2'|1

activities_mapping:
activities_mapping_id|activity_raw|fk_activity_types
---|---|---
0|game|0
1|gaem|0

activity_types:
activity_types_id|activity_type
---|---
0|game
1|movie

### Usage
Commands:
* !(played|lastplayed) - Last known session of a game/streamer
* !firstplayed - First known session of a game/streamer
* !totalplayed - Total playtime across all sessions of a game/streamer + first session + last session + average session length
* !currentlyplaying - Current session information
* !playedToday - A totalplayed limited to the last 24 hours
* !discord - A link to the discord server
* !onDemand - A link to the On Demand page

Options:
* These are valid for lastplayed, firstplayed, and totalplayed
* g: specific game
* s: specific streamer
* t: specific activity

Examples:
```
<Skwid> !played g: Dark Souls
<Metasepia> Skwid, 1d 4h 23m 14s (0y 1d) ago, Skwid played Dark Souls for 2 seconds
```

---

## Prior Art:

Many thanks to [GoaLitiuM](https://github.com/GoaLitiuM) for the original version of this bot that has serviced the community for many years!

The original implementation was in Perl and was well over 4000 lines long! I hope to be able to replicate the original functionality with this project.
