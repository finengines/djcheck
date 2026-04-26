import type { AudioIssue } from '../../../../shared/ipc-types'

// Short display labels for each issue ID
const ISSUE_SHORT: Record<string, string> = {
  WAV_EXTENSIBLE_PCM:       'EXT header',
  WAV_EXTENSIBLE:           'EXT header',
  WAV_32BIT_FLOAT:          '32-bit float',
  WAV_CORRUPT_HEADER:       'Corrupt header',
  WAV_MULTICHANNEL:         'Multichannel',
  WAV_MONO:                 'Mono',
  WAV_SAMPLE_RATE_HIGH:     'High sample rate',
  WAV_SAMPLE_RATE_LOW:      'Low sample rate',
  WAV_BIT_DEPTH_8:          '8-bit',
  WAV_BIT_DEPTH_32INT:      '32-bit int',
  WAV_UNSUPPORTED_FORMAT_TAG:'Bad format tag',
  AIFF_CHUNK_ORDER:         'Chunk order',
  AIFF_COMPRESSED:          'Compressed AIFF',
  AIFF_UNKNOWN_CODEC:       'Unknown codec',
  AIFF_SAMPLE_RATE_HIGH:    'High sample rate',
  AIFF_SAMPLE_RATE_LOW:     'Low sample rate',
  AIFF_BIT_DEPTH_8:         '8-bit',
  AIFF_BIT_DEPTH_32:        '32-bit',
  AIFF_MULTICHANNEL:        'Multichannel',
  AIFF_MONO:                'Mono',
  AIFF_CORRUPT_HEADER:      'Corrupt header',
  MP3_INVALID_SAMPLE_RATE:  'Bad sample rate',
  MP3_MPEG2_SAMPLE_RATE:    'MPEG-2 rate',
  MP3_CORRUPT_FRAMES:       'Corrupt frames',
  MP3_CORRUPT_FRAMES_WARN:  'Frame warning',
  MP3_VBR_NO_XING:          'No Xing header',
  MP3_WRONG_LAYER:          'Wrong layer',
  MP3_NO_VALID_FRAME:       'No valid frame',
  FLAC_UNSUPPORTED:         'FLAC unsupported',
  FLAC_SAMPLE_RATE_HIGH:    'High sample rate',
  FLAC_BIT_DEPTH:           'Bad bit depth',
  ALAC_UNSUPPORTED:         'ALAC unsupported',
  AAC_DRM:                  'DRM protected',
  OGG_UNSUPPORTED:          'OGG unsupported',
  FORMAT_UNKNOWN:           'Unknown format',
  PATH_TOO_LONG:            'Path too long',
  UNICODE_FILENAME:         'Unicode filename',
  ARTWORK_PNG:              'PNG artwork',
  FILE_NOT_FOUND:           'Not found',
  READ_ERROR:               'Read error',
}

// Error code colour mapping
const CODE_COLOR: Record<string, string> = {
  'E-8302': '#f87171',
  'E-8304': '#fb923c',
  'E-8305': '#facc15',
  'E-8306': '#a78bfa',
  'WARNING': '#94a3b8',
  'UNSUPPORTED': '#f87171',
}

interface Props {
  issue: AudioIssue
  compact?: boolean
}

export default function IssueTag({ issue, compact = false }: Props) {
  const label = ISSUE_SHORT[issue.id] ?? issue.id
  const color = CODE_COLOR[issue.code] ?? '#9ca3af'

  const bgColor = `${color}22`
  const borderColor = `${color}44`

  return (
    <span
      title={issue.description}
      className="inline-flex items-center gap-1 rounded-full select-none"
      style={{
        fontSize: compact ? 10 : 11,
        fontWeight: 500,
        padding: compact ? '1px 6px' : '2px 8px',
        background: bgColor,
        color: color,
        border: `1px solid ${borderColor}`,
        whiteSpace: 'nowrap',
        letterSpacing: '0.01em',
      }}
    >
      {!compact && (
        <span style={{ fontSize: 9, opacity: 0.7, fontWeight: 600 }}>{issue.code}</span>
      )}
      {label}
      {issue.canAutoFix && !compact && (
        <span style={{ fontSize: 9, opacity: 0.5 }}>✓</span>
      )}
    </span>
  )
}
