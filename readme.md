# Metasepia

A chatbot for the DopefishLives online streaming community.

---

## Goals:

* Parse and track topic changes
* Provide an accessible API of changes and derived stats
* ???

---

## Design Considerations

Sessions:

session_id|streamer|activity_type|activity|start_timestamp|end_timestamp|raw_topic_string
---|---|---|---|---|---|---
0|Skwid|Game|Dark Souls|1547077201130|1547077210710| 'Streamer: Skwid | Game: Dark Souls | #dopefish_gdq'
1|Dopefish, Fgw_wolf, GUTSMANSASS|Movie|Breakin' 2: Electric Boogaloo|1547077201130|1547077210710| ''

Commands:
* !(played|lastplayed) - Last known session of a game/streamer
* !firstplayed - First known session of a game/streamer
* !totalplayed - Total playtime across all sessions of a game/streamer + first session + last session + average session length
* !currentlyplaying - Current session information

Options:
* (game|g): specific game
* (streamer|s): specific streamer

Examples:
```
<Skwid> !played g: Dark Souls
<Metasepia> Skwid, 1d 4h 23m 14s (0y 1d) ago, Skwid played Dark Souls for 2 seconds
```

---

## Prior Art:

Many thanks to [GoaLitiuM](https://github.com/GoaLitiuM) for the original version of this bot that has serviced the community for many years!

The original implementation was in Perl and was well over 4000 lines long! I hope to be able to replicate the original functionality with this project.
