export type FretboardThemeId = 'dark' | 'rosewood' | 'maple' | 'blue'

export type FretboardTheme = {
  id: FretboardThemeId
  label: string
  neckStart: string
  neckEnd: string
  fret: string
  nut: string
  string: string
  fretNumber: string
  fretNumberStroke: string
  stringName: string
  marker: string
  markerOpacity: number
}

export const FRETBOARD_THEMES: FretboardTheme[] = [
  {
    id: 'dark',
    label: 'Dark',
    neckStart: '#202725',
    neckEnd: '#090d0d',
    fret: '#a9b7ad',
    nut: '#f1f4e8',
    string: '#edf4ee',
    fretNumber: '#f9ffea',
    fretNumberStroke: '#050706',
    stringName: '#f9ffea',
    marker: '#e9f5df',
    markerOpacity: 0.24,
  },
  {
    id: 'rosewood',
    label: 'Rosewood',
    neckStart: '#5a3024',
    neckEnd: '#26120f',
    fret: '#d7c6a4',
    nut: '#fff1cf',
    string: '#f6ead0',
    fretNumber: '#fff6dc',
    fretNumberStroke: '#170908',
    stringName: '#fff6dc',
    marker: '#f7ddb2',
    markerOpacity: 0.28,
  },
  {
    id: 'maple',
    label: 'Maple',
    neckStart: '#d9b96d',
    neckEnd: '#8b682d',
    fret: '#f7e1a8',
    nut: '#fff8de',
    string: '#3d3327',
    fretNumber: '#11140f',
    fretNumberStroke: '#fff2b8',
    stringName: '#11140f',
    marker: '#3c2f1e',
    markerOpacity: 0.26,
  },
  {
    id: 'blue',
    label: 'Blue Steel',
    neckStart: '#243746',
    neckEnd: '#081018',
    fret: '#a9c8d6',
    nut: '#e8f6ff',
    string: '#d9f1ff',
    fretNumber: '#effbff',
    fretNumberStroke: '#02090f',
    stringName: '#effbff',
    marker: '#c8f0ff',
    markerOpacity: 0.25,
  },
]

export function getFretboardTheme(themeId: FretboardThemeId) {
  return FRETBOARD_THEMES.find((theme) => theme.id === themeId) ?? FRETBOARD_THEMES[0]
}
