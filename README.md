# Miditar

Miditar is a browser-based MIDI fretboard trainer for chord-marked MIDI files. It reads MIDI marker meta-events, maps selected note tracks onto guitar strings and frets, and can export a new MIDI file using guitar string channels.

Live app: https://santismo.github.io/miditar/

## Features

- Open one or more `.mid` / `.midi` files.
- Dark mode by default.
- Remembers the most recently loaded MIDI files in the current browser.
- Single settings panel for file loading, example-song loading, track selection, view mode, sound selection, playback speed, MIDI density, instrument height, export, and visual theme.
- GitHub folder-scanned example song menu for hosted MIDI files.
- Primary and secondary MIDI track selectors, plus an optional bass track selector that defaults to off.
- Smart Guitar mode is enabled by default for playable voicings, open strings, melody-aware chord placement, and octave-fit bass notes.
- Configurable guitar string channel maps for export and optional source-channel-based guitar display.
- Sample-backed playback options for acoustic guitar, nylon guitar, electric guitar, electric bass, and piano, with synth fallback.
- Guitar and piano view modes. Piano mode switches the falling MIDI lanes to keyboard lanes, lights full keys while notes play, and uses compact stacked accidental labels.
- VexFlow-rendered notation with first-measure clef/time signature, rests, noteheads, stems, 32nd-note quantization, and accidentals.
- Falling-note fretboard view with chord markers, adjustable density, fret-aligned lanes, and a playhead at the fretboard edge.
- Live guitar fretboard with selectable visual themes, or live piano keyboard in piano mode, with adjustable instrument height.
- Mobile-friendly three-view layout: sheet strip, falling notes, and instrument view stay visible together.
- Playback from the header with tick-synced manual scrubbing from the sheet or falling-note views.
- Safari and mobile browser install metadata with Miditar app icons matching the header logo.
- Guitar mapping for standard tuning: E4, B3, G3, D3, A2, E2.
- Mapped MIDI export with chord markers preserved and string channels assigned:
  - default: high E through low E on channels 11-16
  - optional presets: low E through high E on channels 1-6, or high E through low E on channels 1-6
  - custom: each string can be assigned to any MIDI channel 1-16

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

Hosted example MIDI files:

Place `.mid` / `.midi` files in `public/example midi songs/` on the `main` branch. Miditar scans that public GitHub folder at runtime and lists the file names in the Load Example Song menu, with no importer or manifest required.

## MIDI Notes

Miditar uses MIDI marker events as the source of truth for chord labels in the falling-note view, sheet view, and mapped MIDI export.

The string/fret mapping is heuristic. Smart Guitar mode favors reachable chord spans, avoids duplicate strings in same-tick chords, keeps voicings in string order, allows open strings, fits out-of-range notes by octave, and biases chord placement toward the selected melody track when available.

When Use MIDI Channels As Strings is enabled, Miditar first tries to place notes on the string assigned to their source MIDI channel. Notes that do not match the selected channel map, or do not fit on that string, fall back to the normal fretboard mapping.

Notation is quantized from MIDI timing for readable measure-level engraving. Dense overlapping MIDI passages are grouped into same-start chords where possible. It is an in-browser MIDI engraving preview, not a full MusicXML transcription engine.

## License

MIT License. See [LICENSE](LICENSE).
