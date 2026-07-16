# Miditar

Miditar is a browser-based MIDI, tablature, fretboard, and piano trainer. It reads MIDI marker meta-events, analyzes missing chord labels, maps selected note tracks onto guitar strings and frets, and can export a new MIDI file using guitar string channels.

Live app: https://santismo.github.io/miditar/

Desktop app: https://santismo.github.io/miditar/desktop/

## Features

- Open one or more MIDI, Guitar Pro (`.gp`, `.gp3`, `.gp4`, `.gp5`, `.gpx`), or MusicXML (`.musicxml`, `.mxl`, `.xml`) files.
- Guitar Pro imports retain authored string/fret choices for the tab, falling notes, fretboard, auditioning, and export, with a switch to fall back to Miditar's smart mapping.
- Automatically generates chord markers when a file does not contain them, with a command to reanalyze only the selected tracks.
- Separate open-license Guitar, Piano/Ragtime, and Video Game catalog loaders, each with its own random-song button and links to browse the upstream collections.
- Dark mode by default.
- Remembers the most recently loaded MIDI files in the current browser.
- Single settings panel for file loading, example-song loading, track selection, view mode, sound selection, playback speed, MIDI density, instrument height, export, and visual theme.
- GitHub folder-scanned example song menu for hosted MIDI files.
- Separate desktop URL that keeps the main app layout with the earlier roomier fretboard/piano proportion.
- Primary and secondary MIDI track selectors, plus an optional bass track selector that defaults to off.
- Smart Guitar mode is enabled by default for playable voicings, open strings, melody-aware chord placement, and octave-fit bass notes.
- Smart Guitar Melody can protect a selected track slot as exact-pitch melody while accompaniment is octave-fit around it.
- Chord Melody Mode biases guitar voicings so the selected melody sits on upper strings while accompaniment stays playable below and nearby.
- Configurable guitar string channel maps for export and optional source-channel-based guitar display.
- Sample-backed playback options for acoustic guitar, nylon guitar, electric guitar, electric bass, and piano, with synth fallback.
- Local SF2, SF3, and DLS SoundFont playback that preserves MIDI channel programs, remembers the selected bank in the browser, and links to a song-name search on Musical Artifacts.
- Guitar and piano view modes. Guitar mode defaults to scrolling tab notation, with sheet music still selectable. Piano mode switches the falling MIDI lanes to keyboard lanes, lights full keys while notes play, and uses compact stacked accidental labels.
- VexFlow-rendered sheet notation with first-measure clef/time signature, rests, noteheads, stems, 32nd-note quantization, and accidentals.
- Falling-note fretboard view with chord markers, adjustable density, fret-aligned lanes, string-colored guitar notes, overlap-aware split same-fret lanes, and a playhead at the fretboard edge.
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

Build the checked-in, self-contained iPhone/SPCK edition:

```bash
npm run build:offline
```

The generated `miditar-offline/` folder has relative asset paths, a local manifest of all example songs, synth-only playback, and a service worker that precaches the app and MIDI library. See [MIDITAR_OFFLINE_SPCK.md](MIDITAR_OFFLINE_SPCK.md) for iPhone setup and offline-use instructions.

Lint:

```bash
npm run lint
```

Hosted example MIDI files:

Place `.mid` / `.midi` files in `public/example midi songs/` on the `main` branch. The mobile and desktop pages both scan that public GitHub folder at runtime and list the file names in the Load Example Song menu, with no importer or manifest required.

## Connected music sources

The built-in loaders intentionally use small, openly licensed catalogs and show their source/license in the UI:

- Guitar MIDI: [ClassTab](https://github.com/baweaver/classtab) (MIT collection; selected public-domain compositions).
- Piano and ragtime MusicXML: [MuseTrainer public-domain library](https://github.com/musetrainer/library).
- Video-game-style MIDI cues: [e_midi](https://github.com/davehorner/e_midi/tree/develop/e_midi/midi) (CC0 1.0).

Browse links also point to ClassTab, Songsterr, Ultimate Guitar's Guitar Pro catalog, Mutopia, VGMusic, and OpenGameArt. Those sites stay external so their own download, attribution, and redistribution terms remain visible to the user.

## MIDI Notes

Miditar uses MIDI marker events as the source of truth for chord labels when they are present. Otherwise it analyzes duration- and velocity-weighted pitch classes on each beat, scores common chord templates and inversions, and generates markers for the falling-note, tab/sheet, and mapped MIDI views.

The string/fret mapping is heuristic. Smart Guitar mode favors reachable chord spans, avoids duplicate strings in same-tick chords, keeps voicings in string order, allows open strings, fits out-of-range notes by octave, and biases chord placement toward the selected melody track when available. Chord Melody Mode adds stronger upper-voice placement for the selected melody while nudging harmony and bass notes below it.

When Use MIDI Channels As Strings is enabled, Miditar first tries to place notes on the string assigned to their source MIDI channel. Notes that do not match the selected channel map, or do not fit on that string, fall back to the normal fretboard mapping.

Notation and tab display are quantized from MIDI timing for readable measure-level engraving, using both even 32nd-note positions and triplet subdivisions. Dense overlapping MIDI passages are grouped into same-start chords where possible, and duplicate same-pitch/same-start notes are collapsed for display with the selected melody track preferred. It is an in-browser MIDI engraving preview, not a full MusicXML transcription engine.

## License

MIT License. See [LICENSE](LICENSE).
