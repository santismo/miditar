# Miditar

Miditar is a browser-based MIDI fretboard trainer for chord-marked MIDI files. It reads MIDI marker meta-events, maps selected note tracks onto guitar strings and frets, and can export a new MIDI file using guitar string channels.

Live app: https://santismo.github.io/miditar/

## Features

- Open one or more `.mid` / `.midi` files.
- Dark mode by default.
- Remembers the most recently loaded MIDI files in the current browser.
- Single settings panel for file loading, example-song loading, track selection, view mode, sound selection, playback speed, MIDI density, export, and visual theme.
- Manifest-driven example song menu for hosted MIDI files.
- Primary, secondary, and bass MIDI track selectors for viewing one, two, or three parts on one neck.
- Smart Guitar mode is enabled by default for playable voicings, open strings, melody-aware chord placement, and octave-fit bass notes.
- Sample-backed playback options for acoustic guitar, nylon guitar, electric guitar, electric bass, and piano, with synth fallback.
- Guitar and piano view modes. Piano mode switches the falling MIDI lanes to keyboard lanes and narrows sound choices to piano/synth.
- VexFlow-rendered notation with first-measure clef/time signature, rests, noteheads, stems, 32nd-note quantization, and accidentals.
- Falling-note fretboard view with chord markers, adjustable density, fret-aligned lanes, and a playhead at the fretboard edge.
- Live guitar fretboard with selectable visual themes, or live piano keyboard in piano mode.
- Mobile-friendly three-view layout: sheet strip, falling notes, and instrument view stay visible together.
- Playback from the header with manual scrubbing from the sheet or falling-note views.
- Safari and mobile browser install metadata with Miditar app icons matching the header logo.
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

Import hosted example MIDI files:

```bash
npm run examples:import -- "/path/to/authorized midi folder"
```

This copies `.mid` / `.midi` files into `public/examples/midi/` and rebuilds `public/examples/manifest.json`, which drives the in-app Load Example Song menu. Only publish MIDI files that are original, public-domain, CC0, or otherwise licensed/authorized for redistribution.

## MIDI Notes

Miditar uses MIDI marker events as the source of truth for chord labels in the falling-note view, sheet view, and mapped MIDI export.

The string/fret mapping is heuristic. Smart Guitar mode favors reachable chord spans, avoids duplicate strings in same-tick chords, keeps voicings in string order, allows open strings, fits out-of-range notes by octave, and biases chord placement toward the selected melody track when available.

Notation is quantized from MIDI timing for readable measure-level engraving. Dense overlapping MIDI passages are grouped into same-start chords where possible. It is an in-browser MIDI engraving preview, not a full MusicXML transcription engine.

## License

MIT License. See [LICENSE](LICENSE).
