import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const root = fileURLToPath(new URL('../', import.meta.url))
const app = path.join(root, 'app')
const output = path.join(root, 'dist')
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const files = ['index.html', 'styles.css', 'core.js', 'main.js', 'pwa.js', 'banks-data.js', 'regulations-data.js', 'manifest.webmanifest', 'assets/icon.svg', 'assets/icon.png', 'assets/icon-192.png']
const hash = createHash('sha256')
const payloads = files.map(file => {
  let data = fs.readFileSync(path.join(app, file))
  if (file === 'index.html') data = Buffer.from(data.toString().replace(/(<meta name="app-version" content=")[^"]+/, `$1${version}`))
  // Git uses CRLF locally and LF on Actions. Canonical text makes builds reproducible.
  if (!file.endsWith('.png')) data = Buffer.from(data.toString().replace(/\r\n/g, '\n'))
  hash.update(file).update(data)
  return [file, data]
})
const worker = fs.readFileSync(path.join(app, 'sw.js'), 'utf8').replace(/\r\n/g, '\n')
const revision = hash.update(worker).digest('hex').slice(0, 16)
if (!worker.includes('__PWA_CACHE_REVISION__')) throw new Error('Service worker is missing its revision marker')

// Never follow a symlink or clean a directory outside this project's build output.
if (fs.existsSync(output)) {
  if (fs.lstatSync(output).isSymbolicLink() || fs.realpathSync(output) !== path.join(fs.realpathSync(root), 'dist')) throw new Error('Unsafe build output path')
  fs.rmSync(output, { recursive: true })
}
fs.mkdirSync(path.join(output, 'assets'), { recursive: true })
for (const [file, data] of payloads) fs.writeFileSync(path.join(output, file), data)
fs.writeFileSync(path.join(output, 'sw.js'), worker.replace('__PWA_CACHE_REVISION__', revision))
fs.writeFileSync(path.join(output, '.nojekyll'), '')
fs.writeFileSync(path.join(output, 'release.json'), JSON.stringify({ version, revision }, null, 2) + '\n')
console.log(`PWA ${version} built in dist/ — cache revision ${revision}`)
