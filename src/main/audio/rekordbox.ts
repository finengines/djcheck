import * as fs from 'fs/promises'
import * as path from 'path'
import { XMLParser, XMLBuilder } from 'fast-xml-parser'

export interface RekordboxTrack {
  TrackID: string | number
  Name: string
  Artist?: string
  Album?: string
  Genre?: string
  Kind?: string
  Location: string
  TotalTime?: number
  DiscNumber?: number
  TrackNumber?: number
  Year?: number
  AverageBpm?: number
  DateAdded?: string
  BitRate?: number
  SampleRate?: number
  Comments?: string
  PlayCount?: number
  Rating?: number
  Remixer?: string
  Tonality?: string
  Label?: string
  Mix?: string
  Colour?: string
  POSITION_MARK?: RekordboxPositionMark | RekordboxPositionMark[]
  [key: string]: unknown
}

export interface RekordboxPositionMark {
  Name: string
  Type: number // 0=Cue, 1=FadeIn, 2=FadeOut, 3=Load, 4=Loop
  Start: number
  End?: number
  Num: number // -1=memory cue, 0-7=hot cue A-H
}

export interface RekordboxLibrary {
  parsed: Record<string, unknown>
  tracks: Map<string, RekordboxTrack> // key = decoded file path
  version: string | null
}

const PARSER_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseAttributeValue: true,
  isArray: (name: string) => name === 'TRACK' || name === 'POSITION_MARK' || name === 'TEMPO',
}

const BUILDER_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: '',
  format: true,
  indentBy: '  ',
}

function decodeLocation(location: string): string {
  // rekordbox Location format: file://localhost/path/to/file.wav
  return decodeURIComponent(
    location.replace(/^file:\/\/localhost/, '').replace(/^file:\/\//, '')
  )
}

function encodeLocation(filePath: string): string {
  const encoded = filePath
    .split(path.sep)
    .map(segment => encodeURIComponent(segment))
    .join('/')
  const prefix = filePath.startsWith('/') ? 'file://localhost' : 'file://localhost/'
  return prefix + (filePath.startsWith('/') ? '' : '/') + encoded.replace(/^\//, '')
}

export async function parseRekordboxXml(xmlPath: string): Promise<RekordboxLibrary> {
  const xml = await fs.readFile(xmlPath, 'utf-8')
  const parser = new XMLParser(PARSER_OPTIONS)
  const parsed = parser.parse(xml)

  const tracks = new Map<string, RekordboxTrack>()
  const collection = parsed?.DJ_PLAYLISTS?.COLLECTION?.TRACK ?? []
  const trackArray: RekordboxTrack[] = Array.isArray(collection) ? collection : [collection]

  for (const track of trackArray) {
    if (!track?.Location) continue
    const filePath = decodeLocation(String(track.Location))
    tracks.set(filePath, track)
  }

  // Extract rekordbox version from XML header or ProductName attribute
  const version: string | null =
    (parsed?.DJ_PLAYLISTS?.ProductName as string) ??
    (parsed?.DJ_PLAYLISTS?.Version as string) ??
    null

  return { parsed, tracks, version }
}

export interface ConversionMap {
  originalPath: string
  outputPath: string
}

export async function updateRekordboxXml(
  library: RekordboxLibrary,
  conversions: ConversionMap[],
  outputXmlPath: string
): Promise<{ updatedCount: number; hotCueWarnings: string[] }> {
  const builder = new XMLBuilder(BUILDER_OPTIONS)
  const updated = JSON.parse(JSON.stringify(library.parsed)) as Record<string, unknown>

  const collection = (updated as Record<string, Record<string, Record<string, unknown[]>>>)
    ?.DJ_PLAYLISTS?.COLLECTION?.TRACK ?? []
  const trackArray: RekordboxTrack[] = Array.isArray(collection) ? collection : []

  let updatedCount = 0
  const hotCueWarnings: string[] = []

  for (const { originalPath, outputPath } of conversions) {
    const origLocation = encodeLocation(originalPath)
    const track = trackArray.find(t => {
      const loc = String(t.Location ?? '')
      return loc === origLocation ||
        decodeLocation(loc) === originalPath ||
        decodeLocation(loc) === path.resolve(originalPath)
    })

    if (!track) continue

    track.Location = encodeLocation(outputPath)
    updatedCount++

    // Warn if track has >8 hot cues (export mode limit)
    const marks = track.POSITION_MARK
    if (marks) {
      const markArray = Array.isArray(marks) ? marks : [marks]
      const hotCues = markArray.filter(m => m.Num >= 0 && m.Type === 0)
      if (hotCues.length > 8) {
        hotCueWarnings.push(
          `"${track.Name}" has ${hotCues.length} hot cues — export mode only supports 8 (A–H). Hot cues 9+ will be lost on CDJ.`
        )
      }
    }
  }

  const xmlOutput = builder.build(updated)
  await fs.writeFile(outputXmlPath, xmlOutput, 'utf-8')

  return { updatedCount, hotCueWarnings }
}

export function detectRekordboxVersion(library: RekordboxLibrary): {
  version: string | null
  isBroken: boolean
  warning: string | null
} {
  const v = library.version
  const isBroken = v?.includes('7.2.12') ?? false
  return {
    version: v,
    isBroken,
    warning: isBroken
      ? 'rekordbox 7.2.12 has a known USB export bug that causes tracks to fail loading on CDJs. Downgrade to 7.2.11 and re-export your USB.'
      : null,
  }
}
