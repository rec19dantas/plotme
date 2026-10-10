/**
 * PLOTME 0.3 - API BETA PRIVADA (Cloudflare Worker, ES Module).
 * Conta pessoal para testes. NAO publicar sem autenticacao por usuario,
 * controle de gastos, limites de uso e politicas de privacidade.
 *
 * Segredos em Workers > Settings > Variables and Secrets:
 *   RUNWAY_API_KEY    (Secret) - API key da Runway Dev
 *   PLOTME_TEST_KEY   (Secret) - codigo aleatorio >= 24 caracteres
 *   ALLOWED_ORIGIN    (Text)   - https://rec19dantas.github.io
 *
 * Controle de custos: /generate exige ENABLE_PAID_GENERATION=true
 * além das chaves secretas. Em modo grátis, mantenha desativado.
 * IMPORTANTE: nao salve as credenciais neste arquivo!
 */
const RUNWAY = 'https://api.dev.runwayml.com';
const API_VERSION = '2024-11-06';
const DEFAULT_ORIGIN = 'https://rec19dantas.github.io';
const MAX_REQUEST_CHARS = 4_500_000;
const styles = {
  cinema: 'Photorealistic film, physically plausible motion, natural skin texture, professional cinema lighting',
  anime: 'Original hand-drawn anime animation, painterly cel-shaded aesthetic, expressive cinematic lighting',
  ilustracao: 'Original cinematic digital illustration, painterly strokes, rich atmospheric depth',
  '3d': 'Original high-quality stylized 3D animated feature film, expressive materials and soft light'
};
const genres = {
  apocalipse: ['post-apocalyptic world at dawn, drifting dust and tense atmosphere', 'the survivor moves carefully through a ruined city', 'a reveal of distant hope behind ruined towers'],
  fantasia: ['ancient medieval kingdom, flags moving slowly in the wind', 'the traveler enters a foggy stone castle courtyard', 'a dramatic reveal of a glowing mountain on the horizon'],
  terror: ['foggy forest at night, unsettling shadows and distant movement', 'a figure investigates a flickering light, subtle suspense', 'an ominous doorway opens in the distance, atmospheric tension'],
  romance: ['warm cinematic city at sunset, gentle emotional atmosphere', 'a quiet heartfelt moment among glowing street lights', 'soft golden light and a hopeful final glance'],
  espaco: ['a vast space station overlooking a luminous planet', 'a traveler turns toward the window as stars move softly', 'a breathtaking cosmic horizon reveals itself'],
  suspense: ['rainy neon-lit city street, intriguing shadows', 'a detective follows an unknown clue through the crowd', 'a quiet revelation with reflected city lights']
};
const jsonHeaders = origin => ({
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Plotme-Test-Key',
  'Vary': 'Origin'
});
function response(data,status,origin){return new Response(JSON.stringify(data),{status,headers:jsonHeaders(origin)});}
function promptFor({theme,look,artstyle,scene,title}){
  const aesthetic = look==='arte' ? styles[artstyle] : styles.cinema;
  const sceneInfo = genres[theme][scene];
  const safeTitle = typeof title==='string' ? title.trim().slice(0,45).replace(/[<>\r\n]/g,'') : '';
  return `A single continuous 5-second vertical cinematic shot based on the supplied starting photograph. ${aesthetic}. `+
    `Genre and scene: ${sceneInfo}. Preserve the main subject, facial identity and clothing of the original photograph as much as possible. `+
    `Use coherent subtle motion, smooth controlled camera dolly, atmospheric depth and natural continuity. `+
    `No trademarks, no logos, no captions, no text overlays, no gore. `+
    (safeTitle ? `Story title for context only: ${safeTitle}. Do not render letters on screen.` : '');
}
function isUUID(s){return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);}
function errorRunway(status){
  if(status===401||status===403)return 'A chave de API da Runway não foi aceita. Confira o segredo RUNWAY_API_KEY.';
  if(status===402)return 'Créditos insuficientes na conta Runway Dev.';
  if(status===429)return 'Limite temporário da Runway atingido. Aguarde antes de tentar novamente.';
  if(status===400||status===422)return 'A Runway rejeitou a imagem ou o roteiro. Confira a imagem e tente outra foto.';
  return `Falha na comunicação com a Runway (HTTP ${status}). Tente novamente mais tarde.`;
}
async function runwayRequest(path,env,init){
  const result=await fetch(RUNWAY+path,{
    ...init,
    headers:{Authorization:`Bearer ${env.RUNWAY_API_KEY}`,'X-Runway-Version':API_VERSION,...(init?.headers||{})}
  });
  if(!result.ok)throw {status:result.status,error:errorRunway(result.status)};
  const data=await result.json().catch(()=>null);
  if(!data)throw {status:502,error:'A Runway retornou uma resposta inesperada.'};
  return data;
}
export default {
  async fetch(request,env){
    const allowedOrigin = env.ALLOWED_ORIGIN || DEFAULT_ORIGIN;
    const origin = request.headers.get('Origin');
    const cors = jsonHeaders(allowedOrigin);
    if(origin && origin!==allowedOrigin){
      return new Response('Origin not allowed',{status:403,headers:{'Cache-Control':'no-store'}});
    }
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
    try{
      const url=new URL(request.url);
      // Status público e inofensivo para o GitHub Pages. Nunca expõe segredos.
      if(url.pathname==='/status' && request.method==='GET'){
        return response({online:true,service:'PLOTME API',mode:'demo',videoGenerationEnabled:false},200,allowedOrigin);
      }
      const token=request.headers.get('X-Plotme-Test-Key')||'';
      if(!env.PLOTME_TEST_KEY || env.PLOTME_TEST_KEY.length<24 || !env.RUNWAY_API_KEY){
        return response({error:'Configure RUNWAY_API_KEY e PLOTME_TEST_KEY (mínimo 24 caracteres) nos segredos do Worker.'},503,allowedOrigin);
      }
      if(token!==env.PLOTME_TEST_KEY){return response({error:'Código beta inválido.'},401,allowedOrigin);}
      if(url.pathname==='/health'&&request.method==='GET')return response({ready:true,service:'PLOTME IA beta',duration:5},200,allowedOrigin);
      if(url.pathname==='/generate'&&request.method==='POST'){
        if(env.ENABLE_PAID_GENERATION!=='true')return response({error:'Geração por IA desativada no modo gratuito. Nenhum crédito será consumido.'},403,allowedOrigin);
        const type=request.headers.get('Content-Type')||'';
        if(!type.startsWith('application/json'))return response({error:'Envie JSON.'},415,allowedOrigin);
        const length=Number(request.headers.get('Content-Length'));
        if(length>MAX_REQUEST_CHARS)return response({error:'Foto grande demais. Envie uma imagem menor.'},413,allowedOrigin);
        const raw=await request.text();
        if(raw.length>MAX_REQUEST_CHARS)return response({error:'Foto grande demais. Envie uma imagem menor.'},413,allowedOrigin);
        let input;
        try{input=JSON.parse(raw)}catch{return response({error:'JSON inválido.'},400,allowedOrigin)}
        if(typeof input.imageData!=='string'||!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(input.imageData)||input.imageData.length>4_400_000){
          return response({error:'Imagem inválida. Envie uma fotografia JPEG compactada.'},400,allowedOrigin);
        }
        if(!genres[input.theme]||!['arte','cinema'].includes(input.look)||!styles[input.artstyle]||!Number.isInteger(input.scene)||input.scene<0||input.scene>2){
          return response({error:'Tema, estilo ou número da cena inválidos.'},400,allowedOrigin);
        }
        const result=await runwayRequest('/v1/image_to_video',env,{
          method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({model:'gen4_turbo',promptImage:input.imageData,promptText:promptFor(input),ratio:'720:1280',duration:5})
        });
        if(!isUUID(result.id))return response({error:'A Runway não retornou um identificador válido.'},502,allowedOrigin);
        return response({taskId:result.id,status:'PENDING'},202,allowedOrigin);
      }
      const task=url.pathname.match(/^\/(tasks|download)\/([^/]+)$/);
      if(task && request.method==='GET'){
        const [,type,id]=task;
        if(!isUUID(id))return response({error:'Identificador da geração inválido.'},400,allowedOrigin);
        const result=await runwayRequest('/v1/tasks/'+id,env);
        if(type==='tasks'){
          return response({taskId:id,status:result.status},200,allowedOrigin);
        }
        if(result.status!=='SUCCEEDED'||!Array.isArray(result.output)||typeof result.output[0]!=='string'){
          return response({error:'O vídeo ainda não está disponível para download.'},409,allowedOrigin);
        }
        const resource=new URL(result.output[0]);
        if(resource.protocol!=='https:')return response({error:'URL do vídeo inválida.'},502,allowedOrigin);
        // Apenas URLs entregues pela API autenticada da Runway são acessadas aqui.
        const media=await fetch(resource.toString(),{redirect:'error'});
        if(!media.ok||!media.body)return response({error:'O vídeo expirou ou não pode ser baixado. Tente acessá-lo pela conta Runway.'},502,allowedOrigin);
        return new Response(media.body,{status:200,headers:{
          ...cors,'Content-Type':'video/mp4','Content-Disposition':'attachment; filename="PLOTME_cena.mp4"',
          'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'
        }});
      }
      return response({error:'Rota não encontrada.'},404,allowedOrigin);
    }catch(e){
      const status=Number(e?.status)||500;
      // Erros de fornecedores não expõem chaves nem payloads privados.
      return response({error:e?.error||'Falha inesperada no servidor. Verifique os logs do Cloudflare.'},status,allowedOrigin);
    }
  }
};
