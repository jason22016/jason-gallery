// exif.GPSAltitudeRef === 'Below Sea Level' => 1
// exif.GPSAltitudeRef === 'Above Sea Level' => 0

import type { AfilmoryManifest } from '@afilmory/typing'

import type { ManifestMigrator, MigrationContext } from '../migrate'

export const migrateV9ToV10: ManifestMigrator = (raw: AfilmoryManifest, _ctx: MigrationContext) => {
  raw.data.forEach((item) => {
    if (!item.exif) return
    if ((item.exif.GPSAltitudeRef as any) === 'Below Sea Level') {
      item.exif.GPSAltitudeRef = 1
    } else {
      item.exif.GPSAltitudeRef = 0
    }
  })
  ;(raw as any).version = 'v10'
  return raw
}
