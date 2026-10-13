import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {JSDOM,VirtualConsole} from 'jsdom';import {parseExtensionManifest} from '../../sdk/dist/manifest.js'
import {Script} from 'node:vm'
const html=await readFile(new URL('../player.html',import.meta.url),'utf8'),manifest=JSON.parse(await readFile(new URL('../extension.json',import.meta.url),'utf8'))
const descriptor={version:1,handle:'abc123',name:'video.mp4',mimeType:'video/mp4',sizeBytes:75000000,revision:'rev',url:'saycode-file-preview://abc123/content'}
function page(d=descriptor){const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));const dom=new JSDOM(html,{runScripts:'outside-only',url:'https://extension.test/player.html?language=ko#file-preview='+encodeURIComponent(JSON.stringify(d)),virtualConsole:vc});new Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]).runInContext(dom.getInternalVMContext());return{dom,document:dom.window.document,errors}}
test('the package declares the new generic viewer and only selected-file read permission',()=>{const parsed=parseExtensionManifest(manifest,{supportedApiVersion:4,minimumSupportedApiVersion:2});assert.deepEqual(parsed.permissions,['filePreviews.read']);assert.ok(parsed.contributes.fileViewers[0].extensions.includes('mp4'))})
test('the player streams a capability URL without autoplay or copying file bytes',()=>{const {dom,document,errors}=page();assert.deepEqual(errors,[]);const video=document.querySelector('video');assert.equal(video.src,descriptor.url);assert.equal(video.preload,'metadata');assert.equal(video.controls,true);assert.equal(video.autoplay,false);assert.equal(video.getAttribute('aria-label'),'video.mp4');video.dispatchEvent(new dom.window.Event('error'));assert.match(document.getElementById('status').textContent,/코덱/);dom.window.close()})
test('an arbitrary remote URL cannot become a media source',()=>{const {dom,document,errors}=page({...descriptor,url:'https://example.com/private.mp4'});assert.deepEqual(errors,[]);assert.equal(document.querySelector('video'),null);assert.match(document.getElementById('status').textContent,/다시/);dom.window.close()})
test('API 4 is isolated while existing API 2 and 3 manifests remain supported',()=>{
 const options={supportedApiVersion:4,minimumSupportedApiVersion:2};
 for(const apiVersion of [2,3]){
  assert.equal(parseExtensionManifest({...manifest,apiVersion,permissions:[],contributes:{}},options).apiVersion,apiVersion);
  assert.throws(()=>parseExtensionManifest({...manifest,apiVersion},options));
  assert.throws(()=>parseExtensionManifest({...manifest,apiVersion,permissions:[],contributes:{fileViewers:[]}},options));
 }
 assert.throws(()=>parseExtensionManifest({...manifest,permissions:[]},options));
 assert.throws(()=>parseExtensionManifest({...manifest,contributes:{...manifest.contributes,fileViewers:[{...manifest.contributes.fileViewers[0],panelId:'other.panel'}]}},options));
 assert.throws(()=>parseExtensionManifest(manifest,{supportedApiVersion:3,minimumSupportedApiVersion:2}));
})
