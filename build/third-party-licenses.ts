// Vite plugin: writes third-party-licenses.txt into the build with the license text of every npm
// package that actually ends up in the bundle. MIT/BSD/ISC/Apache/Zlib all require their notices to
// travel with the code, and minification drops most license comments.
import fs from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'

/** For dual-licensed packages, the license we use. */
const CHOSEN: Record<string, string> = {
  dompurify: 'Apache-2.0', // "MPL-2.0 OR Apache-2.0"
  rgbcolor: 'MIT', // "MIT OR SEE LICENSE IN FEEL-FREE.md"
}

/** Licenses that live in source headers rather than a license file (pako is "MIT AND Zlib"). */
const EXTRA: Record<string, (dir: string) => string> = {
  pako: (dir) => {
    const header = fs.readFileSync(path.join(dir, 'lib/zlib/deflate.js'), 'utf8').match(/^(\/\/.*\n)+/m)?.[0] ?? ''
    return `zlib license (from pako's zlib port, lib/zlib/*):\n\n${header.replace(/^\/\/ ?/gm, '').trim()}`
  },
}

// LICENSE, LICENSE.md, COPYING, LICENSE-MIT.txt… (dompurify also has LICENSE-MPL; the shortest name wins)
const LICENSE_FILE = /^(licen[cs]e|copying)([-_.][\w.-]*)?$/i

function packageOf(id: string): { name: string; dir: string } | null {
  const file = id.replace(/^\0/, '').split('?')[0]
  const i = file.lastIndexOf('node_modules/')
  if (i < 0) return null
  const parts = file.slice(i + 'node_modules/'.length).split('/')
  const name = parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0]
  return { name, dir: file.slice(0, i) + 'node_modules/' + name }
}

function licenseText(dir: string, chosen?: string): string {
  const files = fs.readdirSync(dir).filter((f) => LICENSE_FILE.test(f))
  // Prefer the file matching the chosen license (e.g. dompurify ships LICENSE and LICENSE-MPL).
  const file = files.sort((a, b) => a.length - b.length)[0]
  if (!file) throw new Error(`No license file in ${dir}${chosen ? ` (chosen: ${chosen})` : ''}`)
  return fs.readFileSync(path.join(dir, file), 'utf8').trim()
}

export function thirdPartyLicenses(): Plugin {
  return {
    name: 'third-party-licenses',
    apply: 'build',
    generateBundle(_options, bundle) {
      const packages = new Map<string, string>()
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue
        for (const id of chunk.moduleIds) {
          const pkg = packageOf(id)
          if (pkg) packages.set(pkg.name, pkg.dir)
        }
      }
      const sections = [...packages]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, dir]) => {
          const meta = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
          const declared = typeof meta.license === 'string' ? meta.license : (meta.license?.type ?? 'unknown')
          const license = CHOSEN[name] ? `${CHOSEN[name]} (chosen from: ${declared})` : declared
          const extra = EXTRA[name] ? `\n\n${EXTRA[name](dir)}` : ''
          return `${'='.repeat(78)}\n${name}@${meta.version}\nLicense: ${license}\n${meta.homepage ?? meta.repository?.url ?? ''}\n${'-'.repeat(78)}\n\n${licenseText(dir, CHOSEN[name])}${extra}\n`
        })
      this.emitFile({
        type: 'asset',
        fileName: 'third-party-licenses.txt',
        source:
          'Scarf Ace includes the following open source software. Their licenses require these notices.\n' +
          'The Courier Prime font is licensed separately: see fonts/OFL.txt.\n\n' +
          sections.join('\n'),
      })
    },
  }
}
