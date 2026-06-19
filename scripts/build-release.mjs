import { mkdir, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const releaseDir = 'release'
const packageName = 'portfolio-review-local'
const ref = process.env.RELEASE_REF || 'HEAD'
const version = process.env.GITHUB_REF_NAME || spawnGit(['rev-parse', '--short', ref]).trim()
const outputPath = join(releaseDir, `${packageName}-${version}.zip`)

function spawnGit(args) {
  const result = spawnSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(' ')} failed.`)
  }

  return result.stdout
}

await rm(releaseDir, { recursive: true, force: true })
await mkdir(releaseDir, { recursive: true })

spawnGit([
  'archive',
  '--format=zip',
  `--output=${outputPath}`,
  `--prefix=${packageName}/`,
  ref,
])

console.log(`Created ${outputPath}`)
