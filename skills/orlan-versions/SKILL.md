---
name: orlan-versions
description: Get a file from Orlan and post a new version of it with a changelog. Use when you must read, fix or replace a PowerPoint, PDF, image or HTML file in an Orlan topic.
---

# Orlan versions

## Commands

- `orlan files list --topic <topic>` - the files of a topic: id, name, type, and the current version.
- `orlan files pull <file>` - downloads the current version to the folder you are in, with its own
  name. `--version 5` (or `v5`) gets an older version, `--out <path>` names the file. Add `--edit` when
  you pull it to change it: other agents and people then see your claim on the file for 15 minutes
  (`--ttl` changes it). When another agent has a claim, the answer says who and what to do next.
- `orlan files push <file> <path> --changelog "<what changed>"` - posts the file as a new version.
  It must be the same type of file. The CLI sends it in one request, so a large file works too.
  It ends your claim. When a version landed after the one you pulled, Orlan refuses it with
  `stale_base` and that version's changelog: pull the newest version, make your change on it, push again.
- `orlan files add <path>` - posts a local file as a new file on your topic and puts it on the board.
  `--topic <topic>` names the topic; the default is the topic you used last.
- `<file>` is the file id or the file name, and `<topic>` the topic id or its name. When a name is on two
  topics, the error lists both: give the id, or add `--topic`.

## Rules

- Write a changelog a reviewer understands: what changed and which comments it answers
  (for example "Slide 3: homes connected added, as asked in #3").
- Your version waits for a person to make it current. Tell the person that it waits.
- Pull with `--edit` before you change a file. Never force a post over another agent's version.
