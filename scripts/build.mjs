import { rm } from 'node:fs/promises'
import { build } from 'tsdown'

await rm(new URL('../lib', import.meta.url), { recursive: true, force: true })

await build({
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: 'esm',
  platform: 'node',
  target: 'es2022',
  dts: true,
  clean: false,
})
