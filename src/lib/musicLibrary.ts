export type MusicLibraryCategory = 'guitar' | 'piano' | 'video-game'

export type MusicLibraryEntry = {
  id: string
  category: MusicLibraryCategory
  title: string
  subtitle: string
  fileName: string
  url: string
  sourceName: string
  sourceUrl: string
  license: string
}

export type MusicLibrarySource = {
  label: string
  url: string
}

const CLASSTAB_RAW = 'https://raw.githubusercontent.com/baweaver/classtab/master/app/midis'
const MUSETRAINER_RAW = 'https://raw.githubusercontent.com/musetrainer/library/master/scores'
const GAME_MIDI_RAW = 'https://raw.githubusercontent.com/davehorner/e_midi/develop/e_midi/midi'

export const MUSIC_LIBRARY_LABELS: Record<MusicLibraryCategory, string> = {
  guitar: 'Guitar, Rock, Shred & Classical',
  piano: 'Piano & Ragtime',
  'video-game': 'Video Game',
}

export const MUSIC_LIBRARY_SOURCES: Record<MusicLibraryCategory, MusicLibrarySource[]> = {
  guitar: [
    { label: 'Browse ClassTab', url: 'https://github.com/baweaver/classtab' },
    { label: 'Browse rock & shred MIDIs', url: 'https://github.com/thewildwestmidis/midis' },
    { label: 'Search Yngwie / shred MIDIs', url: 'https://midifind.com/files/m/malmsteen_yngwie/1290' },
    { label: 'Browse Songsterr', url: 'https://www.songsterr.com/' },
    { label: 'Browse Guitar Pro tabs', url: 'https://www.ultimate-guitar.com/explore?type%5B%5D=Pro' },
  ],
  piano: [
    { label: 'Browse MuseTrainer', url: 'https://musetrainer.github.io/library/' },
    { label: 'Browse ASAP', url: 'https://github.com/fosfrancesco/asap-dataset' },
    { label: 'Browse Mutopia', url: 'https://www.mutopiaproject.org/cgibin/make-table.cgi?Instrument=Piano' },
  ],
  'video-game': [
    { label: 'Browse game archive', url: 'https://github.com/ryanrudes/game-midis' },
    { label: 'Browse VGMusic', url: 'https://www.vgmusic.com/' },
    { label: 'Browse CC0 game MIDI', url: 'https://opengameart.org/content/15-melodic-rpg-chiptunes' },
  ],
}

export const MUSIC_LIBRARY: MusicLibraryEntry[] = [
  {
    id: 'guitar-romance-de-amor',
    category: 'guitar',
    title: 'Romance de Amor',
    subtitle: 'Anonymous · classical guitar',
    fileName: 'Romance_de_Amor.mid',
    url: `${CLASSTAB_RAW}/anon_romance_de_amor_1.mid`,
    sourceName: 'ClassTab',
    sourceUrl: 'https://github.com/baweaver/classtab',
    license: 'MIT collection · public-domain composition',
  },
  {
    id: 'guitar-capricho-arabe',
    category: 'guitar',
    title: 'Capricho Árabe',
    subtitle: 'Francisco Tárrega · classical guitar',
    fileName: 'Capricho_Arabe.mid',
    url: `${CLASSTAB_RAW}/tarrega_capricho_arabe.mid`,
    sourceName: 'ClassTab',
    sourceUrl: 'https://github.com/baweaver/classtab',
    license: 'MIT collection · public-domain composition',
  },
  {
    id: 'guitar-recuerdos',
    category: 'guitar',
    title: 'Recuerdos de la Alhambra',
    subtitle: 'Francisco Tárrega · tremolo study',
    fileName: 'Recuerdos_de_la_Alhambra.mid',
    url: `${CLASSTAB_RAW}/tarrega_recuerdos_de_la_alhambra.mid`,
    sourceName: 'ClassTab',
    sourceUrl: 'https://github.com/baweaver/classtab',
    license: 'MIT collection · public-domain composition',
  },
  {
    id: 'guitar-bach-prelude',
    category: 'guitar',
    title: 'Lute Suite No. 4: Preludio',
    subtitle: 'J. S. Bach · BWV 1006a',
    fileName: 'Bach_BWV1006a_Preludio.mid',
    url: `${CLASSTAB_RAW}/bach_js_bwv1006a_lute_suite_no4_in_e_1_preludio.mid`,
    sourceName: 'ClassTab',
    sourceUrl: 'https://github.com/baweaver/classtab',
    license: 'MIT collection · public-domain composition',
  },
  {
    id: 'guitar-sor-etude',
    category: 'guitar',
    title: 'Étude in D, Op. 6 No. 1',
    subtitle: 'Fernando Sor · classical guitar',
    fileName: 'Sor_Op6_No1.mid',
    url: `${CLASSTAB_RAW}/sor_op06_no01_etude_in_d.mid`,
    sourceName: 'ClassTab',
    sourceUrl: 'https://github.com/baweaver/classtab',
    license: 'MIT collection · public-domain composition',
  },
  {
    id: 'piano-maple-leaf',
    category: 'piano',
    title: 'Maple Leaf Rag',
    subtitle: 'Scott Joplin · ragtime',
    fileName: 'Maple_Leaf_Rag.mxl',
    url: `${MUSETRAINER_RAW}/Maple_Leaf_Rag_Scott_Joplin.mxl`,
    sourceName: 'MuseTrainer public-domain library',
    sourceUrl: 'https://github.com/musetrainer/library',
    license: 'Public domain',
  },
  {
    id: 'piano-entertainer',
    category: 'piano',
    title: 'The Entertainer',
    subtitle: 'Scott Joplin · ragtime',
    fileName: 'The_Entertainer.mxl',
    url: `${MUSETRAINER_RAW}/The_Entertainer_-_Scott_Joplin_-_1902.mxl`,
    sourceName: 'MuseTrainer public-domain library',
    sourceUrl: 'https://github.com/musetrainer/library',
    license: 'Public domain',
  },
  {
    id: 'piano-fur-elise',
    category: 'piano',
    title: 'Für Elise',
    subtitle: 'L. van Beethoven · classical piano',
    fileName: 'Fur_Elise.mxl',
    url: `${MUSETRAINER_RAW}/Fur_Elise.mxl`,
    sourceName: 'MuseTrainer public-domain library',
    sourceUrl: 'https://github.com/musetrainer/library',
    license: 'Public domain',
  },
  {
    id: 'piano-moonlight',
    category: 'piano',
    title: 'Moonlight Sonata: 1st Movement',
    subtitle: 'L. van Beethoven · classical piano',
    fileName: 'Moonlight_Sonata_1.mxl',
    url: `${MUSETRAINER_RAW}/Sonate_No._14_Moonlight_1st_Movement.mxl`,
    sourceName: 'MuseTrainer public-domain library',
    sourceUrl: 'https://github.com/musetrainer/library',
    license: 'Public domain',
  },
  {
    id: 'piano-turkish-march',
    category: 'piano',
    title: 'Rondo alla Turca',
    subtitle: 'W. A. Mozart · classical piano',
    fileName: 'Rondo_alla_Turca.mxl',
    url: `${MUSETRAINER_RAW}/Piano_Sonata_No._11_K._331_3rd_Movement_Rondo_alla_Turca.mxl`,
    sourceName: 'MuseTrainer public-domain library',
    sourceUrl: 'https://github.com/musetrainer/library',
    license: 'Public domain',
  },
  {
    id: 'game-powerup',
    category: 'video-game',
    title: 'Power-Up Jingle',
    subtitle: 'Game cue · rising scale',
    fileName: 'Power_Up.mid',
    url: `${GAME_MIDI_RAW}/powerup.mid`,
    sourceName: 'e_midi game cues',
    sourceUrl: 'https://github.com/davehorner/e_midi/tree/develop/e_midi/midi',
    license: 'CC0 1.0',
  },
  {
    id: 'game-coin',
    category: 'video-game',
    title: 'Coin Pickup',
    subtitle: 'Game cue · coin jingle',
    fileName: 'Coin_Pickup.mid',
    url: `${GAME_MIDI_RAW}/coin.mid`,
    sourceName: 'e_midi game cues',
    sourceUrl: 'https://github.com/davehorner/e_midi/tree/develop/e_midi/midi',
    license: 'CC0 1.0',
  },
  {
    id: 'game-success',
    category: 'video-game',
    title: 'Level Complete',
    subtitle: 'Game cue · triumphant rise',
    fileName: 'Level_Complete.mid',
    url: `${GAME_MIDI_RAW}/success_2.mid`,
    sourceName: 'e_midi game cues',
    sourceUrl: 'https://github.com/davehorner/e_midi/tree/develop/e_midi/midi',
    license: 'CC0 1.0',
  },
  {
    id: 'game-panic',
    category: 'video-game',
    title: 'Boss Warning',
    subtitle: 'Game cue · dramatic alarm',
    fileName: 'Boss_Warning.mid',
    url: `${GAME_MIDI_RAW}/panic_2.mid`,
    sourceName: 'e_midi game cues',
    sourceUrl: 'https://github.com/davehorner/e_midi/tree/develop/e_midi/midi',
    license: 'CC0 1.0',
  },
]

export function entriesForCategory(category: MusicLibraryCategory) {
  return MUSIC_LIBRARY.filter((entry) => entry.category === category)
}
