import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const fixtureNames = ['builtin-nat', 'stdlib-nat', 'cubical-prelude']

export async function readFixture(rootDir, fixture) {
  if (!fixtureNames.includes(fixture)) {
    throw new Error(`Unknown fixture ${fixture}. Expected one of: ${fixtureNames.join(', ')}`)
  }
  return readFile(join(rootDir, 'fixtures', `${fixture}.agda`), 'utf8')
}
