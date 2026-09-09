import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const configuredWorkdir = process.env.JASON_GALLERY_PHOTO_WORKDIR
if (configuredWorkdir && !path.isAbsolute(configuredWorkdir)) {
  throw new Error('JASON_GALLERY_PHOTO_WORKDIR must be absolute')
}
export const workdir = configuredWorkdir ?? path.resolve(__dirname, '../../../apps/web')
