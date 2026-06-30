# Miditar

Miditar is a browser-based MIDI fretboard trainer built for Band-in-a-Box exports. It reads MIDI chord marker meta-events, maps one or two note tracks onto guitar strings and frets, and can export a new MIDI file using BIAB-style guitar string channels.

Live app: https://santismo.github.io/miditar/

## Features

- Drag/drop or open one or more `.mid` / `.midi` files.
- Dark mode by default.
- Playlist and two MIDI track selectors for viewing two parts on one neck.
- Falling-note fretboard view with chord markers in the flow lane.
- Horizontal scrolling sheet-style view with chord markers above each measure.
- Persistent three-view layout: sheet strip, falling notes, and live fretboard stay visible together.
- Mobile-friendly layout with a persistent transport bar.
- Playback speed control and timeline scrubber.
- Guitar mapping for standard tuning: E4, B3, G3, D3, A2, E2.
- Mapped MIDI export with chord markers preserved and string channels assigned:
  - channel 11: high E
  - channel 12: B
  - channel 13: G
  - channel 14: D
  - channel 15: A
  - channel 16: low E

No Midiano source code is used.

## Development

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
```

Lint:

```bash
npm run lint
```

## MIDI Notes

Band-in-a-Box can export chords as MIDI marker events. Miditar keeps those markers as the source of truth for chord labels in the falling-note view, sheet view, and mapped MIDI export.

The string/fret mapping is heuristic. It favors reachable positions, avoids duplicate strings in same-tick chords, keeps chord voicings in string order, and minimizes hand-position jumps across the track.
