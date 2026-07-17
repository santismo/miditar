export type OnlineSoundFont = {
  id: string
  name: string
  description: string
  url: string
  fallbackUrl?: string
  sizeBytes: number
  license: string
  sourceUrl: string
  keywords: string[]
}

export const ONLINE_SOUNDFONTS: OnlineSoundFont[] = [
  {
    id: 'timgm6mb',
    name: 'TimGM6mb General MIDI',
    description: 'Fast, mobile-friendly GM bank for complete multi-track arrangements.',
    url: 'https://raw.githubusercontent.com/kujirahand/picosakura/main/synth/fonts/TimGM6mb.sf2',
    fallbackUrl: 'https://cdn.jsdelivr.net/gh/kujirahand/picosakura@main/synth/fonts/TimGM6mb.sf2',
    sizeBytes: 5_969_788,
    license: 'GPL-licensed SoundFont',
    sourceUrl: 'https://github.com/kujirahand/picosakura/tree/main/synth/fonts',
    keywords: ['general midi', 'gm', 'game', 'retro', 'rpg', 'mobile', 'chiptune'],
  },
  {
    id: 'generaluser-gs',
    name: 'GeneralUser GS',
    description: 'Full GM/GS bank with 261 presets and 13 drum kits for piano, rock, and orchestral MIDI.',
    url: 'https://raw.githubusercontent.com/mrbumpy409/GeneralUser-GS/main/GeneralUser-GS.sf2',
    fallbackUrl: 'https://cdn.jsdelivr.net/gh/mrbumpy409/GeneralUser-GS@main/GeneralUser-GS.sf2',
    sizeBytes: 32_319_396,
    license: 'GeneralUser GS license · free use and modification',
    sourceUrl: 'https://github.com/mrbumpy409/GeneralUser-GS',
    keywords: ['piano', 'classical', 'ragtime', 'rock', 'metal', 'guitar', 'shred', 'orchestra', 'general midi', 'gm', 'gs'],
  },
  {
    id: 'nes',
    name: 'NES SoundFont',
    description: 'Community console bank for clearly NES-era songs.',
    url: 'https://raw.githubusercontent.com/Daniel-176/Usefull-Soundfonts/main/NES%20Soundfont.SF2',
    fallbackUrl: 'https://cdn.jsdelivr.net/gh/Daniel-176/Usefull-Soundfonts@main/NES%20Soundfont.SF2',
    sizeBytes: 6_744_228,
    license: 'Community bank · sample rights vary · personal playback',
    sourceUrl: 'https://github.com/Daniel-176/Usefull-Soundfonts',
    keywords: ['nes', 'famicom', 'mega man', 'castlevania', 'contra', 'metroid', 'super mario bros'],
  },
  {
    id: 'snes',
    name: 'SNES SoundFont',
    description: 'Community console bank for clearly SNES-era songs.',
    url: 'https://raw.githubusercontent.com/Daniel-176/Usefull-Soundfonts/main/SNES%20Soundfont.sf2',
    fallbackUrl: 'https://cdn.jsdelivr.net/gh/Daniel-176/Usefull-Soundfonts@main/SNES%20Soundfont.sf2',
    sizeBytes: 1_852_478,
    license: 'Community bank · sample rights vary · personal playback',
    sourceUrl: 'https://github.com/Daniel-176/Usefull-Soundfonts',
    keywords: ['snes', 'super nintendo', 'chrono trigger', 'final fantasy vi', 'final fantasy 6', 'earthbound', 'super metroid'],
  },
  {
    id: 'n64',
    name: 'Nintendo 64 SoundFont',
    description: 'Community console bank for clearly Nintendo 64-era songs.',
    url: 'https://raw.githubusercontent.com/Daniel-176/Usefull-Soundfonts/main/N64%20SoundFont.sf2',
    fallbackUrl: 'https://cdn.jsdelivr.net/gh/Daniel-176/Usefull-Soundfonts@main/N64%20SoundFont.sf2',
    sizeBytes: 12_499_702,
    license: 'Community bank · sample rights vary · personal playback',
    sourceUrl: 'https://github.com/Daniel-176/Usefull-Soundfonts',
    keywords: ['n64', 'nintendo 64', 'mario 64', 'ocarina', 'goldeneye', 'banjo', 'perfect dark'],
  },
  {
    id: 'wii',
    name: 'Wii SoundFont',
    description: 'Community console bank for clearly Wii-era songs.',
    url: 'https://raw.githubusercontent.com/Daniel-176/Usefull-Soundfonts/main/Wii%20SoundFont.sf2',
    fallbackUrl: 'https://cdn.jsdelivr.net/gh/Daniel-176/Usefull-Soundfonts@main/Wii%20SoundFont.sf2',
    sizeBytes: 17_681_950,
    license: 'Community bank · sample rights vary · personal playback',
    sourceUrl: 'https://github.com/Daniel-176/Usefull-Soundfonts',
    keywords: ['wii', 'mario galaxy', 'xenoblade', 'wii sports'],
  },
]

export function rankSoundFonts(query: string) {
  const normalized = query.toLowerCase()
  return ONLINE_SOUNDFONTS.map((soundFont, index) => {
    let score = -index / 100
    for (const keyword of soundFont.keywords) {
      if (normalized.includes(keyword)) score += keyword.length >= 4 ? 10 : 4
    }
    if (soundFont.id === 'generaluser-gs' && /piano|classical|ragtime|rock|metal|guitar|shred|solo/.test(normalized)) {
      score += 7
    }
    if (soundFont.id === 'timgm6mb' && /game|retro|rpg|midi/.test(normalized)) score += 5
    if (soundFont.id === 'timgm6mb') score += 1
    return { soundFont, score }
  })
    .sort((a, b) => b.score - a.score)
    .map(({ soundFont }) => soundFont)
}

export function formatSoundFontSize(sizeBytes: number) {
  return `${(sizeBytes / 1024 / 1024).toFixed(sizeBytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
}
