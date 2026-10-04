import assert from 'node:assert/strict';
import http from 'node:http';
import { after, it } from 'node:test';
import { createVideoExporter } from './video-export.mjs';

let exporter, activeFactories = 0, maxFactories = 0, attempted = [];
const server = http.createServer(async (req,res) => {
  if (exporter && await exporter.handle(req,res,new URL(req.url,`http://${req.headers.host}`).pathname)) return;
  res.writeHead(404);res.end();
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
exporter=createVideoExporter({origin,recordingsRoot:'.',opensaRoot:'.',chromiumPath:'mock',
  rendererFactory:async(options)=>{
    activeFactories++;maxFactories=Math.max(maxFactories,activeFactories);
    const url=new URL(options.sourceUrl);attempted.push({view:JSON.parse(url.searchParams.get('exportView')),range:JSON.parse(url.searchParams.get('exportRange'))});
    try {
      await new Promise(resolve=>setTimeout(resolve,100));
      if(options.signal.aborted)throw Object.assign(new Error('Cancelled mock renderer'),{name:'AbortError'});
      throw new Error('Mock renderer initialization failure');
    } finally {activeFactories--;}
  }});
after(async()=>{await new Promise(resolve=>server.close(resolve));});
const posed={position:[100,200,-300],yaw:0,pitch:0,fovYDeg:60};
const views=[
  {mode:'shot',shot:{kind:'fixed',...posed}},
  {mode:'shot',shot:{kind:'tracking',...posed}},
  {mode:'shot',shot:{kind:'follow',offset:[-30,-10,8],fovYDeg:60}},
  {mode:'shot',shot:{kind:'cockpit',fovYDeg:60,cockpitLookPose:{yaw:0,pitch:0,height:0,lateral:0,longitudinal:0}}},
];
const body={csv:'local_timestamp,model,x,y,z,capture_elapsed_s\n2026-10-04T00:00:00.000,520,0,0,100,0\n',
  filename:'flight_batch_test.csv',audioMode:'synth',fps:30,range:{start:1.25,end:2.5},views};
async function post(value,route='/video-export/batch',requestOrigin=origin){return fetch(origin+route,{method:'POST',headers:{Origin:requestOrigin,'Content-Type':'application/json'},body:JSON.stringify(value)});}
async function terminal(id){
  for(let i=0;i<100;i++){
    const value=await(await fetch(`${origin}/video-export/batch/${id}`)).json();
    if(['ready','failed','cancelled'].includes(value.state))return value;
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  assert.fail('Batch never released its queue');
}

it('validates the complete batch before creating jobs or invoking a renderer',async()=>{
  const invalid=[{range:{start:2,end:1}},{range:{start:-1,end:2}},{range:{start:0,end:7201}},
    {views:[]},{views:[views[0],views[0]]},{views:[...views,views[0]]},
    {views:[{mode:'shot',shot:{kind:'unknown',...posed}}]},
    {views:[{mode:'shot',shot:{kind:'fixed',...posed,fovYDeg:180}}]},
    {views:[{mode:'shot',shot:{kind:'follow',offset:[0,0,0],fovYDeg:60}}]},
    {views:[{mode:'shot',shot:{kind:'cockpit',fovYDeg:60,cockpitLookPose:{yaw:0,pitch:0,height:100,lateral:0,longitudinal:0}}}]}];
  for(const value of invalid)assert.equal((await post({...body,...value})).status,400);
  assert.equal((await post(body,'/video-export/batch','https://example.test')).status,403);
  assert.equal(exporter.jobs.size,0);assert.deepEqual(attempted,[]);
});

it('cancels active and queued jobs, holds the lock through cleanup, and allows another batch afterwards',async()=>{
  const response=await post(body);assert.equal(response.status,202);const batch=await response.json();
  assert.equal(batch.jobs.length,4);assert.equal(batch.jobs.filter(job=>job.state==='queued').length,3);
  assert.equal((await post(body)).status,409);
  const cancel=await post({},`/video-export/batch/${batch.id}/cancel`);assert.equal(cancel.status,200);
  assert.equal((await post(body)).status,409);
  const cancelled=await terminal(batch.id);assert.equal(cancelled.state,'cancelled');
  assert.ok(cancelled.jobs.every(job=>job.state==='cancelled'&&job.downloadUrl===null));
  const next=await post({...body,views:[views[0]]});assert.equal(next.status,202);
  const failed=await terminal((await next.json()).id);assert.equal(failed.state,'failed');assert.equal(failed.jobs.length,1);
  assert.match(failed.jobs[0].message,/Mock renderer/);
});

it('runs distinct shot types sequentially, retains range/name snapshots, and reports each failure',async()=>{
  attempted=[];maxFactories=0;
  const response=await post(body);assert.equal(response.status,202);
  const batch=await terminal((await response.json()).id);
  assert.equal(batch.state,'failed');assert.equal(batch.progress,100);assert.equal(maxFactories,1);
  assert.deepEqual(attempted.map(item=>item.view.shot.kind),['fixed','tracking','follow','cockpit']);
  assert.ok(attempted.every(item=>item.range.start===1.25&&item.range.end===2.5));
  assert.ok(batch.jobs.every(job=>job.state==='failed'&&job.range.start===1.25));
  assert.deepEqual(batch.jobs.map(job=>job.filename),['fixed','tracking','follow','cockpit'].map(kind=>`flight_batch_test_1250-2500ms_${kind}.mp4`));
  const cancelCompleted=await post({},`/video-export/batch/${batch.id}/cancel`);
  assert.equal((await cancelCompleted.json()).state,'failed');
});
