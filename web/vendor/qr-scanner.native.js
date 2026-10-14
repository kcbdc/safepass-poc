/* SafePass camera/image QR scanner. Native BarcodeDetector with locally hosted jsQR fallback. */
(function () {
  'use strict';
  const CANVAS_MAX = 1280;
  function hasNative(){return typeof window.BarcodeDetector === 'function';}
  function hasFallback(){return typeof window.jsQR === 'function';}
  function decodeCanvas(canvas){
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    const data=ctx.getImageData(0,0,canvas.width,canvas.height);
    const hit=window.jsQR(data.data,data.width,data.height,{inversionAttempts:'attemptBoth'});
    return hit?.data || null;
  }
  function scaledCanvas(width,height){
    const scale=Math.min(1,CANVAS_MAX/Math.max(width,height));
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(width*scale));
    canvas.height=Math.max(1,Math.round(height*scale));
    return canvas;
  }
  async function decodeBitmap(source,width,height){
    if(hasNative()){
      try{const detector=new window.BarcodeDetector({formats:['qr_code']});const hits=await detector.detect(source);if(hits.length)return hits[0].rawValue;}catch(_){}
    }
    if(!hasFallback())throw Error('로컬 QR 디코더가 없습니다. Pages 빌드 설정을 확인하세요.');
    const canvas=scaledCanvas(width,height);
    canvas.getContext('2d',{willReadFrequently:true}).drawImage(source,0,0,canvas.width,canvas.height);
    return decodeCanvas(canvas);
  }
  async function imageFromFile(file){
    if(typeof createImageBitmap==='function'){
      try{const bitmap=await createImageBitmap(file);return {source:bitmap,width:bitmap.width,height:bitmap.height,cleanup:()=>bitmap.close?.()};}catch(_){}
    }
    const url=URL.createObjectURL(file);const img=new Image();
    try{await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(Error('이미지 파일을 열 수 없습니다.'));img.src=url;});return {source:img,width:img.naturalWidth,height:img.naturalHeight,cleanup:()=>URL.revokeObjectURL(url)};}
    catch(e){URL.revokeObjectURL(url);throw e;}
  }
  class Html5Qrcode {
    constructor(elementId){this.root=document.getElementById(elementId);this.stream=null;this.video=null;this.running=false;this.busy=false;this.timer=null;this.session=0;}
    static supported(){return hasNative()||hasFallback();}
    static async getCameras(){
      if(!navigator.mediaDevices?.getUserMedia)throw Error('카메라를 지원하지 않는 브라우저입니다. HTTPS와 카메라 권한을 확인하세요.');
      const devices=await navigator.mediaDevices.enumerateDevices?.().catch(()=>[])||[];
      const cameras=devices.filter(d=>d.kind==='videoinput').map(d=>({id:d.deviceId,label:d.label}));
      return cameras.length?cameras:[{id:'environment',label:'후면 카메라'}];
    }
    async start(cameraId,config,onSuccess,onFailure){
      await this.stop();if(!Html5Qrcode.supported())throw Error('QR 디코더가 누락되었습니다. 웹앱을 다시 배포하세요.');
      if(!this.root)throw Error('스캐너 영역을 찾을 수 없습니다.');
      const session=++this.session;
      const video=document.createElement('video');video.autoplay=true;video.muted=true;video.playsInline=true;video.setAttribute('playsinline','');
      video.style.cssText='width:100%;height:auto;display:block;max-height:420px;object-fit:cover';
      this.root.replaceChildren(video);this.video=video;
      try {
        const videoConstraints=cameraId&&cameraId!=='environment'?{deviceId:{ideal:cameraId},facingMode:{ideal:'environment'}}:{facingMode:{ideal:'environment'}};
        this.stream=await navigator.mediaDevices.getUserMedia({audio:false,video:videoConstraints});
        video.srcObject=this.stream;await video.play();this.running=true;
        const tick=async()=>{
          if(!this.running||this.busy||session!==this.session||video.readyState<2)return;
          this.busy=true;
          try{const value=await decodeBitmap(video,video.videoWidth,video.videoHeight);if(value&&this.running&&session===this.session)await onSuccess(value);}
          catch(e){onFailure?.(String(e));}
          finally{this.busy=false;}
        };
        this.timer=setInterval(tick,Math.max(160,1000/(config?.fps||7)));await tick();
      }catch(e){await this.stop();throw e;}
    }
    async scanFile(file){
      if(!Html5Qrcode.supported())throw Error('로컬 QR 디코더가 누락되었습니다.');
      if(!file?.type?.startsWith('image/'))throw Error('이미지 파일만 사용할 수 있습니다.');
      const image=await imageFromFile(file);
      try{const result=await decodeBitmap(image.source,image.width,image.height);if(!result)throw Error('이미지에서 QR 코드를 찾지 못했습니다.');return result;}
      finally{image.cleanup();}
    }
    async stop(){this.running=false;this.session++;if(this.timer){clearInterval(this.timer);this.timer=null;}if(this.stream){for(const t of this.stream.getTracks())t.stop();this.stream=null;}if(this.video){this.video.srcObject=null;this.video=null;}}
    async clear(){await this.stop();this.root?.replaceChildren();}
  }
  window.Html5Qrcode=Html5Qrcode;
})();
