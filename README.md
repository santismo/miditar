# Miditar

Miditar is a browser-based MIDI fretboard trainer for chord-marked MIDI files. It reads MIDI marker meta-events, maps selected note tracks onto guitar strings and frets, and can export a new MIDI file using guitar string channels.

Live app: https://santismo.github.io/miditar/

## Features

- Open one or more `.mid` / `.midi` files.
- Dark mode by default.
- Remembers the most recently loaded MIDI files in the current browser.
- Single settings panel for file loading, track selection, Smart Guitar mode, playback speed, MIDI density, export, and fretboard theme.
- Primary, secondary, and bass MIDI track selectors for viewing one, two, or three parts on one neck.
- Smart Guitar mode is enabled by default for playable voicings, open strings, melody-aware chord placement, and octave-fit bass notes.
- Scrollable sheet-style view with chord markers above each measure.
- Falling-note fretboard view with chord markers in the flow lane and adjustable density.
- Live guitar fretboard with selectable visual themes.
- Mobile-friendly three-view layout: sheet strip, falling notes, and fretboard stay visible together.
- Playback from the header with manual scrubbing from the sheet or falling-note views.
- Safari and mobile browser install metadata with Miditar app icons.
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

Miditar uses MIDI marker events as the source of truth for chord labels in the falling-note view, sheet view, and mapped MIDI export.

The string/fret mapping is heuristic. Smart Guitar mode favors reachable chord spans, avoids duplicate strings in same-tick chords, keeps voicings in string order, allows open strings, fits out-of-range notes by octave, and biases chord placement toward the selected melody track when available.

## License

MIT License. See [LICENSE](LICENSE).
