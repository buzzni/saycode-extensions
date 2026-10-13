export function mountMediaPreview(window) {
 const {document, location, parent} = window;
 const ko=new URLSearchParams(location.search).get('language')==='ko';
 const status=document.getElementById('status'), surface=document.getElementById('surface');
 const say=message=>{status.textContent=message;status.hidden=!message};
 let media;
 try{
  const d=JSON.parse(decodeURIComponent(location.hash.replace(/^#file-preview=/,'')));
  const url=new URL(d.url);
  if(d.version!==1||typeof d.name!=='string'||/[\\/\0]/.test(d.name)||!Number.isSafeInteger(d.sizeBytes)||d.sizeBytes<0||url.protocol!=='saycode-file-preview:'||url.hostname!==d.handle||url.pathname!=='/content'||url.search||url.hash||!/^audio\/|^video\//.test(d.mimeType))throw Error();
  media=document.createElement(d.mimeType.startsWith('audio/')?'audio':'video');media.controls=true;media.preload='metadata';media.playsInline=true;media.setAttribute('aria-label',d.name);media.title=d.name;
  media.addEventListener('loadedmetadata',()=>{say('');parent.postMessage({type:'saycode:file-preview-ready',version:1,handle:d.handle},'*')});
  media.addEventListener('waiting',()=>say(ko?'영상을 불러오는 중…':'Buffering…'));
  media.addEventListener('playing',()=>say(''));
  media.addEventListener('error',()=>say(ko?'파일을 재생할 수 없습니다. 연결 상태와 지원하는 코덱인지 확인하거나 원본을 저장해 열어주세요.':'Cannot play this file. Check the connection or codec, or save the original and open it locally.'));
  surface.appendChild(media);media.src=url.href;
 }catch{say(ko?'미리보기를 열 수 없습니다. 파일을 다시 열어주세요.':'Preview unavailable. Reopen the file.')}
 window.addEventListener('pagehide',()=>{if(media){media.pause();media.removeAttribute('src');media.load()}});
}
if (typeof window !== 'undefined') mountMediaPreview(window)
