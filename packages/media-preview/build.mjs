import {build} from 'esbuild'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
const root=new URL('./',import.meta.url)
const result=await build({entryPoints:[new URL('src/player.js',root).pathname],bundle:true,format:'iife',platform:'browser',write:false,minify:true})
const template=await readFile(new URL('player.html',root),'utf8')
if(!template.includes('<!-- media-player -->'))throw Error('Missing player bootstrap marker')
await mkdir(new URL('dist/',root),{recursive:true})
await writeFile(new URL('dist/player.html',root),template.replace('<!-- media-player -->',`<script>${result.outputFiles[0].text}</script>`))
