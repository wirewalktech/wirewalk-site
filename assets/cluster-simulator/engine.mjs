/* Wirewalk educational cluster model. No external access or vendor software.
   Explicit actions + integer logical ticks make scenarios reproducible. */
export const NODE_COUNTS=[2,4,8,16,32,64,128];
export const RAILS=8;
const STAGES=['OFF','QUEUED','BOOTING','INSTALLING','INSTALLER_CALLINGINIT','UP'];
const copy=x=>structuredClone(x);
const assert=(ok,message)=>{if(!ok)throw new Error(message)};
const bounded=(v,min,max,label)=>{assert(Number.isInteger(v)&&v>=min&&v<=max,label);return v};
export function configuration(input={}){
 const fabric=input.fabric??'spectrumx',storage=input.storage??'lustre',nodes=Number(input.nodes??8),bond=input.bond??'lacp',rate=Number(input.rate??400),seed=Number(input.seed??11);
 assert(['spectrumx','infiniband'].includes(fabric),'Choose Spectrum-X or InfiniBand.');assert(['lustre','gpfs'].includes(storage),'Choose Lustre or GPFS.');assert(NODE_COUNTS.includes(nodes),'Choose a supported cluster size.');assert(['lacp','active-backup'].includes(bond),'Choose a bond mode.');assert([400,800].includes(rate),'Choose 400 or 800 Gb/s rail links.');bounded(seed,1,2147483646,'Seed must be an integer from 1 to 2147483646.');return{fabric,storage,nodes,bond,rate,seed};
}
function log(s,kind,message){s.events.push({id:s.nextEvent++,time:s.time,kind,message});s.events=s.events.slice(-100)}
export function createCluster(input={}){
 const config=configuration(input);const s={schemaVersion:1,config,time:0,rng:config.seed,nextEvent:1,nextJob:1001,started:false,managementUp:true,head:'head-a',headAUp:true,headBUp:true,headFailover:0,slots:4,categoryImage:'gpu-v1',images:[{id:'gpu-v1',driverReady:true,locked:false},{id:'gpu-v2',driverReady:false,locked:false}],nodes:Array.from({length:config.nodes},(_,i)=>({id:'gpu'+String(i+1).padStart(3,'0'),stage:'OFF',stageTime:0,targetImage:'gpu-v1',image:null,driverReady:false,drained:false,gpuFault:false,railMismatch:false,mounted:false,reason:'Powered off'})),rails:Array.from({length:8},(_,i)=>({id:i,up:true,util:0,txUnits:'0',errors:0})),bondMembers:[true,true],ecn:true,storage:{servers:[true,true,true,true],activeMds:0,failover:0},jobs:[],events:[],history:[]};log(s,'info','Virtual cluster created. Eight GPUs and eight EW rails per compute node; independent management/PXE and bonded NS access.');return s;
}
function image(s,id){const x=s.images.find(x=>x.id===id);assert(x,'Unknown image.');return x}
function node(s,id){const n=s.nodes.find(x=>x.id===id);assert(n,'Unknown node.');return n}
export function bondStatus(s){const members=s.bondMembers.filter(Boolean).length;return{members,available:members>0,degraded:members===1,aggregateGbps:(s.config.bond==='lacp'?members:Math.min(1,members))*100,singleFlowGbps:members?100:0}}
export function storageStatus(s){
 const a=s.storage.servers,ns=bondStatus(s).available;
 if(s.config.storage==='lustre'){
  const metadata=a[s.storage.activeMds]&&s.storage.failover===0,targets=a[2]&&a[3];let reason=!metadata?(s.storage.failover?'MDT failover in progress':'Both metadata services unavailable'):!targets?'OST group unavailable; no OSS failover configured':!ns?'NS storage-access bond unavailable':'Mounted and available';
  return{available:Boolean(metadata&&targets&&ns),degraded:a.some(x=>!x),reason,quorum:null,replicas:null,metadataUp:Boolean(metadata),dataUp:Boolean(targets)};
 }
 const quorum=a.slice(0,3).filter(Boolean).length,replicas=(a[0]||a[1])&&(a[2]||a[3]);let reason=quorum<2?'Quorum lost (requires 2 of 3 voters)':!replicas?'A replica group has no available copy':!ns?'NS storage-access bond unavailable':'Mounted and available';return{available:Boolean(quorum>=2&&replicas&&ns),degraded:a.some(x=>!x),reason,quorum,replicas:Boolean(replicas),metadataUp:quorum>=2,dataUp:Boolean(replicas)};
}
export function nodeIssues(s,n,{ignoreDrain=false}={}){
 const out=[];if(n.stage!=='UP')out.push(n.stage==='OFF'?'Powered off':'Provisioning');if(!ignoreDrain&&n.drained)out.push('Drained');if(n.stage==='UP'&&n.image!==n.targetImage)out.push('Image drift');if(n.stage==='UP'&&!n.driverReady)out.push('GPU driver missing from installed image');if(n.gpuFault)out.push('GPU health fault');if(n.railMismatch)out.push('GPU/HCA rail mapping mismatch');if(s.rails.some(r=>!r.up))out.push('EW rail unavailable');if(n.stage==='UP'&&!n.mounted)out.push('Storage mount unavailable');return out;
}
function inUse(s,id){return s.jobs.some(j=>j.state==='RUNNING'&&j.allocated.includes(id))}
function health(s){const available=storageStatus(s).available;for(const n of s.nodes){n.mounted=n.stage==='UP'&&available;n.reason=n.stage==='UP'?(nodeIssues(s,n).join('; ')||'Ready for scheduled work'):n.stage==='OFF'?'Powered off':image(s,n.targetImage).locked?'Image locked; provisioning deferred':(!s.managementUp||s.headFailover)?'Waiting for management/PXE':n.stage==='QUEUED'?'Waiting for a provisioning slot':n.stage}}
export function summary(s){
 const up=s.nodes.filter(n=>n.stage==='UP').length,ready=s.nodes.filter(n=>!nodeIssues(s,n).length).length,allocated=s.jobs.filter(j=>j.state==='RUNNING').reduce((v,j)=>v+j.allocated.length,0);return{up,ready,allocated,total:s.nodes.length,gpus:s.nodes.length*8,activeJobs:s.jobs.filter(j=>j.state==='RUNNING').length,pendingJobs:s.jobs.filter(j=>j.state==='PENDING').length,railsUp:s.rails.filter(r=>r.up).length,bond:bondStatus(s),storage:storageStatus(s),provisioning:s.nodes.filter(n=>['BOOTING','INSTALLING','INSTALLER_CALLINGINIT'].includes(n.stage)).length};
}
function provision(s){
 const manager=s.managementUp&&(s.head==='head-a'?s.headAUp:s.headBUp)&&s.headFailover===0;
 if(!manager){for(const n of s.nodes)if(['QUEUED','BOOTING','INSTALLING','INSTALLER_CALLINGINIT'].includes(n.stage))n.reason='Waiting for management/PXE service';return}
 let slots=s.slots-s.nodes.filter(n=>['BOOTING','INSTALLING','INSTALLER_CALLINGINIT'].includes(n.stage)).length;
 for(const n of s.nodes){
  if(n.stage==='QUEUED'&&slots>0){if(image(s,n.targetImage).locked){n.reason='Requested software image is locked';continue}n.stage='BOOTING';n.stageTime=0;slots--;log(s,'info',n.id+': BOOTING — kernel/initrd (modeled).')}
  if(n.stage==='UP'||n.stage==='OFF'||n.stage==='QUEUED')continue;
  n.stageTime++;
  if(n.stage==='BOOTING'&&n.stageTime>=2){n.stage='INSTALLING';n.stageTime=0;log(s,'info',n.id+': INSTALLING — synchronizing '+n.targetImage+'.')}
  else if(n.stage==='INSTALLING'&&n.stageTime>=3){const im=image(s,n.targetImage);if(im.locked){n.reason='Image locked; provisioning deferred';continue}n.image=im.id;n.driverReady=im.driverReady;n.stage='INSTALLER_CALLINGINIT';n.stageTime=0;log(s,'info',n.id+': image synchronized; switching to local root.')}
  else if(n.stage==='INSTALLER_CALLINGINIT'&&n.stageTime>=1){n.stage='UP';n.stageTime=0;log(s,n.driverReady?'good':'warn',n.id+': UP — simulated CMDaemon connected; readiness is checked separately.')}
 }
}
function failJob(s,j,reason){j.state='FAILED';j.phase='FAILED';j.waiting=false;j.reason=reason;j.allocated=[];log(s,'bad','Job '+j.id+' failed: '+reason+'. Last committed checkpoint '+j.checkpoint+'/'+j.steps+'. Repair, then explicitly requeue.');}
function schedule(s){
 const used=new Set(s.jobs.filter(j=>j.state==='RUNNING').flatMap(j=>j.allocated));
 for(const j of s.jobs.filter(j=>j.state==='PENDING')){
  if(!s.managementUp||s.headFailover||!(s.head==='head-a'?s.headAUp:s.headBUp)){j.reason='Controller/management unavailable';continue}
  const available=s.nodes.filter(n=>!used.has(n.id)&&!nodeIssues(s,n).length);
  if(available.length<j.nodes){j.reason=storageStatus(s).available?'Resources / node readiness':'Storage not ready';continue}
  j.allocated=available.slice(0,j.nodes).map(n=>n.id);j.allocated.forEach(id=>used.add(id));j.state='RUNNING';j.phase='STAGING';j.phaseWork=0;j.reason='Staging input over NS storage access';log(s,'good','Job '+j.id+' allocated '+j.nodes+' nodes / '+j.nodes*8+' GPUs.');
 }
}
function jobsTick(s){
 const io=storageStatus(s).available,bond=bondStatus(s),running=s.jobs.filter(j=>j.state==='RUNNING');
 for(const j of running){
  const nodes=j.allocated.map(id=>node(s,id));
  if(nodes.some(n=>n.stage!=='UP'||n.gpuFault)){failJob(s,j,'Compute node/GPU interruption');continue}
  if(nodes.some(n=>n.railMismatch)||s.rails.some(r=>!r.up)){failJob(s,j,'Collective transport/path interruption (model does not assume transparent NCCL failover)');continue}
  if(['STAGING','CHECKPOINT','FINALIZING'].includes(j.phase)){
   if(!io){j.reason=storageStatus(s).reason;j.waiting=true;continue}
   j.waiting=false;j.phaseWork+=bond.aggregateGbps/100/Math.max(1,running.filter(x=>['STAGING','CHECKPOINT','FINALIZING'].includes(x.phase)).length);
   if(j.phaseWork>=(j.phase==='STAGING'?4:3)){if(j.phase==='FINALIZING'){j.state='COMPLETED';j.phase='COMPLETED';j.checkpoint=j.steps;j.allocated=[];j.reason='Final modeled results committed';log(s,'good','Job '+j.id+' completed modeled work and result publication. Not a real benchmark.');continue}if(j.phase==='CHECKPOINT'){j.checkpoint=Math.floor(j.progress);log(s,'info','Job '+j.id+': committed modeled checkpoint '+j.checkpoint+'.')}j.phase='COMPUTE';j.phaseWork=0;j.reason='Application compute/collectives'}
  }else if(j.phase==='COMPUTE'){
   const factor=s.config.fabric==='spectrumx'&&!s.ecn?0.45:1;const jitter=0.96+random(s)*0.08;j.progress=Math.min(j.steps,j.progress+1.8*Math.sqrt(j.nodes)*factor*jitter);j.reason=factor<1?'RoCE profile mismatch: reduced synthetic progress':'Application compute/collectives';
   if(j.progress>=j.steps){j.phase='FINALIZING';j.phaseWork=0;j.reason='Publishing final results over NS storage access';}
   else if(Math.floor(j.progress/20)>Math.floor(j.checkpoint/20)){j.phase='CHECKPOINT';j.phaseWork=0;j.reason='Checkpoint over NS storage access'}
  }
 }
}
function random(s){s.rng=(Math.imul(s.rng,1664525)+1013904223)>>>0;return s.rng/4294967296}
function metrics(s){
 const working=s.jobs.filter(j=>j.state==='RUNNING'&&j.phase==='COMPUTE').reduce((v,j)=>v+j.nodes,0),fraction=working/s.nodes.length,factor=s.config.fabric==='spectrumx'&&!s.ecn?0.45:1;
 for(const r of s.rails){r.util=r.up?Math.round(fraction*78*factor):0;const bytes=BigInt(Math.round(s.config.rate*1e9/8*r.util/100*s.nodes.length));r.txUnits=(BigInt(r.txUnits)+bytes/4n).toString();if(!r.up&&working)r.errors++;}
 const x=summary(s);s.history.push({time:s.time,ready:x.ready,jobs:x.activeJobs,railUtil:Math.round(s.rails.reduce((v,r)=>v+r.util,0)/8),storage:x.storage.available?1:0});s.history=s.history.slice(-90);
}
export function advance(s,count=1){bounded(count,1,3600,'Advance must be 1–3600 logical seconds.');for(let i=0;i<count;i++){s.time++;if(s.headFailover>0){s.headFailover--;if(!s.headFailover){const candidate=s.headAUp?'head-a':s.headBUp?'head-b':null;if(candidate){s.head=candidate;log(s,'good','Management/controller role now on '+candidate+' (modeled HA).')}}}if(s.config.storage==='lustre'&&!s.storage.servers[s.storage.activeMds]&&s.storage.servers[1-s.storage.activeMds]&&!s.storage.failover)s.storage.failover=3;if(s.storage.failover>0){s.storage.failover--;if(!s.storage.failover&&s.storage.servers[1-s.storage.activeMds]){s.storage.activeMds=1-s.storage.activeMds;log(s,'good','Lustre metadata role moved to standby (assumed shared target/fencing model).')}}provision(s);health(s);schedule(s);jobsTick(s);health(s);metrics(s)}return s}
function reprovision(s,n,target){assert(!inUse(s,n.id),'Node is allocated. Drain and wait or cancel the simulated job first.');n.drained=true;n.targetImage=target;n.stage='QUEUED';n.stageTime=0;n.mounted=false;log(s,'warn',n.id+': drained and queued for reimage to '+target+'.');}
export function action(s,a){
 assert(a&&typeof a.type==='string','Invalid action.');switch(a.type){
 case 'start':s.started=true;for(const n of s.nodes)if(n.stage==='OFF')n.stage='QUEUED';log(s,'info','Cluster power-on requested. Provisioning slots '+s.slots+'.');break;
 case 'submit':{assert(s.jobs.length<40,'Keep at most 40 jobs; reset or export this session.');const nodes=bounded(Number(a.nodes),1,s.nodes.length,'Job node count is outside this cluster.');const steps=bounded(Number(a.steps??120),20,2000,'Work units must be 20–2000.');const name=String(a.name||'training').slice(0,40);const j={id:s.nextJob++,name,nodes,steps,state:'PENDING',phase:'PENDING',progress:0,checkpoint:0,phaseWork:0,allocated:[],reason:'Waiting for scheduler',waiting:false};s.jobs.push(j);log(s,'info','Job '+j.id+' submitted: '+name+'.');break;}
 case 'cancel':{const j=s.jobs.find(j=>j.id===Number(a.id));assert(j,'Unknown job.');assert(['RUNNING','PENDING'].includes(j.state),'Only pending/running jobs can be cancelled.');j.state='CANCELLED';j.phase='CANCELLED';j.waiting=false;j.reason='Cancelled by simulator operator';j.allocated=[];log(s,'warn','Job '+j.id+' cancelled.');break;}
 case 'requeue':{const j=s.jobs.find(j=>j.id===Number(a.id));assert(j&&['FAILED','CANCELLED'].includes(j.state),'Choose a failed or cancelled job.');j.state='PENDING';j.phase='PENDING';j.progress=j.checkpoint;j.phaseWork=0;j.waiting=false;j.reason='Requeued from last committed checkpoint';log(s,'info','Job '+j.id+' explicitly requeued at checkpoint '+j.checkpoint+'.');break;}
 case 'drain':{const n=node(s,a.node);n.drained=true;log(s,'warn',n.id+': drained; existing allocations may finish.');break;}
 case 'resume':{health(s);const n=node(s,a.node),issues=nodeIssues(s,n,{ignoreDrain:true});assert(!issues.length,'Resume refused: '+issues.join('; '));n.drained=false;log(s,'good',n.id+': resumed after model readiness gates.');break;}
 case 'reimage':reprovision(s,node(s,a.node),image(s,a.image??s.categoryImage).id);break;
 case 'image-lock':{const im=image(s,a.image);im.locked=Boolean(a.value);log(s,'warn',im.id+(im.locked?': locked.':': unlocked.'));break;}
 case 'prepare-image':{const im=image(s,a.image);im.driverReady=true;log(s,'good',im.id+': GPU software staged in model image. Existing installed nodes are not changed; reimage canary.');break;}
 case 'break-image':{const im=image(s,a.image);im.driverReady=false;log(s,'warn',im.id+': simulated GPU driver removed from image. Installed node copies unchanged.');break;}
 case 'promote':{const im=image(s,a.image);assert(!im.locked&&im.driverReady,'Target image must be unlocked and include GPU software.');assert(s.nodes.some(n=>n.image===im.id&&!nodeIssues(s,n,{ignoreDrain:true}).length),'Promotion refused: provision and pass a canary first.');s.categoryImage=im.id;for(const n of s.nodes)n.targetImage=im.id;log(s,'warn','Category now desires '+im.id+'. Installed copies remain unchanged until an explicit rolling reimage.');break;}
 case 'rollout':{const im=image(s,s.categoryImage);assert(im.driverReady&&!im.locked,'Category image is not ready.');const batch=s.nodes.filter(n=>n.image!==im.id&&!inUse(s,n.id)&&['UP','OFF'].includes(n.stage)).slice(0,2);assert(batch.length,'No idle out-of-date nodes available in this batch.');for(const n of batch)reprovision(s,n,im.id);break;}
 case 'fault':fault(s,a);break;
 case 'repair-all':s.rails.forEach(r=>r.up=true);s.bondMembers=[true,true];s.storage.servers=[true,true,true,true];s.storage.failover=0;s.managementUp=true;s.headAUp=true;s.headBUp=true;s.headFailover=0;s.ecn=true;for(const n of s.nodes){n.gpuFault=false;n.railMismatch=false}log(s,'good','Faults repaired. Images/drains/checkpoints retained; failed jobs require explicit requeue.');break;
 case 'slots':s.slots=bounded(Number(a.value),1,16,'Provisioning slots must be 1–16.');break;
 default:throw new Error('Unsupported simulator action.');}
 health(s);return s;
}
function fault(s,a){
 const value=a.value===undefined?true:Boolean(a.value);switch(a.kind){
 case 'rail':{const r=s.rails[bounded(Number(a.index),0,7,'Choose rail 1–8.')];r.up=!value;log(s,value?'bad':'good','EW rail '+(r.id+1)+(value?' interrupted.':' restored.'));break;}
 case 'bond':{const i=bounded(Number(a.index),0,1,'Choose a bond member.');s.bondMembers[i]=!value;log(s,value?'warn':'good','NS member '+(i+1)+(value?' down.':' restored.'));break;}
 case 'storage':{const i=bounded(Number(a.index),0,3,'Choose storage server 1–4.');s.storage.servers[i]=!value;if(s.config.storage==='lustre'&&i===s.storage.activeMds&&value&&s.storage.servers[1-i])s.storage.failover=3;log(s,value?'bad':'good','Storage server '+(i+1)+(value?' interrupted.':' restored.'));break;}
 case 'management':s.managementUp=!value;log(s,value?'bad':'good','Management/PXE '+(value?'unavailable.':'restored.'));break;
 case 'head':if(s.head==='head-a')s.headAUp=!value;else s.headBUp=!value;if(value)s.headFailover=3;log(s,value?'warn':'good','Active head interrupted; modeled role recovery begins.');break;
 case 'ecn':assert(s.config.fabric==='spectrumx','ECN profile scenario applies to the Spectrum-X/RoCE model, not InfiniBand.');s.ecn=!value;log(s,value?'warn':'good','RoCE congestion profile '+(value?'mismatch: synthetic progress penalty.':'restored.'));break;
 case 'gpu':node(s,a.node).gpuFault=value;log(s,value?'bad':'good',a.node+': GPU health '+(value?'fault.':'restored.'));break;
 case 'mapping':node(s,a.node).railMismatch=value;log(s,value?'bad':'good',a.node+': rail mapping '+(value?'mismatch.':'restored.'));break;
 default:throw new Error('Unknown fault scenario.');}
}
export function terminal(s,input,selected='gpu001'){
 let line=String(input).trim();assert(line.length<=240,'Command is too long.');const wrapper=line.match(/^cmsh\s+-c\s+(["'])([^\n]+)\1$/);if(wrapper)line=wrapper[2];
 const lines=[],table=(headers,rows)=>{const widths=headers.map((h,i)=>Math.max(h.length,...rows.map(r=>String(r[i]??'').length)));return[headers.map((h,i)=>h.padEnd(widths[i])).join('  '),widths.map(w=>'-'.repeat(w)).join('  '),...rows.map(row=>row.map((v,i)=>String(v).padEnd(widths[i])).join('  '))].join('\n')};
 const n=node(s,selected);
 if(['help','sim help'].includes(line))return 'SIMULATION COMMANDS (finite subset; not an OS shell)\n\nRead current state:\n  cmsh -c "device list"\n  cmsh -c "softwareimage list"\n  cmsh -c "category list"\n  cmsh -c "network list"\n  sinfo | squeue | sacct\n  nvidia-smi -L\n  nvidia-smi topo -m\n  cat /proc/net/bonding/bond0\n  lfs df             (Lustre)\n  mmgetstate -a      (GPFS)\n\nChange only the virtual model:\n  sim start\n  sim step 30\n  sim submit 2 120\n  sim drain gpu001\n  sim resume gpu001\n  sim fault rail 3\n  sim repair\n  sim requeue 1001\n\nOutputs reflect this model, not real BCM, CUDA, Slurm or storage commands.';
 if(line==='device list')return table(['Name','BCM state','Installed image','Readiness'],s.nodes.map(n=>[n.id,n.stage,n.image||'none',n.reason]));
 if(line==='softwareimage list')return table(['Image','Locked','GPU stack staged'],s.images.map(i=>[i.id,i.locked?'yes':'no',i.driverReady?'yes':'no']));
 if(line==='category list')return table(['Category','Desired image','Nodes'],[['gpu-workers',s.categoryImage,s.nodes.length]]);
 if(line==='network list')return table(['Network','Role','State'],[['management','BMC/PXE/control',s.managementUp?'UP':'DOWN'],['ns-bond','storage/client access',bondStatus(s).available?'UP':'DOWN'],[s.config.fabric,'EW / eight GPU rails',summary(s).railsUp+'/8 UP']]);
 if(line==='sinfo')return table(['PARTITION','NODES','READY','ALLOCATED','DRAINED'],[['gpu',s.nodes.length,summary(s).ready,summary(s).allocated,s.nodes.filter(n=>n.drained).length]])+'\nReadiness is a Wirewalk model gate, not a full Slurm state implementation.';
 if(line==='squeue'||line==='sacct')return table(['JOBID','NAME','STATE','PHASE','NODES','PROGRESS','REASON'],s.jobs.filter(j=>line==='sacct'||['PENDING','RUNNING'].includes(j.state)).map(j=>[j.id,j.name,j.state,j.phase,j.nodes,Math.floor(j.progress)+'/'+j.steps,j.reason]));
 if(line==='nvidia-smi -L')return n.stage!=='UP'?'Selected node is not UP.':!n.driverReady?'Simulated driver query unavailable: installed image has no GPU stack.':Array.from({length:8},(_,i)=>'GPU '+i+': Virtual GPU (SIM-ID: '+n.id+'-g'+i+')'+(n.gpuFault&&i===0?' [health fault]':'')).join('\n');
 if(line==='nvidia-smi topo -m')return 'Synthetic affinity map for '+n.id+' (not an actual topology legend)\n'+table(['GPU','HCA','Physical rail','Link'],Array.from({length:8},(_,i)=>{const rail=n.railMismatch&&i<2?1-i:i;return['GPU'+i,'mlx5_'+i+':1','rail-'+(rail+1),s.rails[rail].up?'UP':'DOWN']}));
 if(line==='cat /proc/net/bonding/bond0'){const b=bondStatus(s);return 'Synthetic Linux bond view\nMode: '+(s.config.bond==='lacp'?'802.3ad / LACP':'active-backup')+'\nMII Status: '+(b.available?'up':'down')+'\nns0: '+(s.bondMembers[0]?'up':'down')+'\nns1: '+(s.bondMembers[1]?'up':'down')+'\nModeled multi-flow aggregate: '+b.aggregateGbps+' Gb/s per node\nSingle-flow link bound: '+b.singleFlowGbps+' Gb/s\nAssumes compatible switch configuration; no LACP timing emulation.';}
 if(line==='lfs df'){assert(s.config.storage==='lustre','Lustre is not selected. Use mmgetstate -a for the GPFS model.');const x=storageStatus(s);return 'Synthetic Lustre service view\n'+table(['Service','State'],[['MDT role',x.metadataUp?'available':'unavailable'],['OST group A',s.storage.servers[2]?'available':'unavailable'],['OST group B',s.storage.servers[3]?'available':'unavailable'],['Client access',x.available?'available':x.reason]])}
 if(line==='mmgetstate -a'){assert(s.config.storage==='gpfs','GPFS is not selected. Use lfs df for the Lustre model.');const x=storageStatus(s);return 'Synthetic GPFS state view\nQuorum: '+x.quorum+'/3 voters (2 required)\nReplica groups: '+(x.replicas?'available':'a group has no copy')+'\nFilesystem: '+(x.available?'available':x.reason)+'\n'+table(['Server','State'],s.storage.servers.map((up,i)=>['storage'+(i+1),up?'active':'down']));}
 const p=line.split(/\s+/);if(p[0]==='sim'){
  if(p[1]==='start'&&p.length===2)action(s,{type:'start'});
  else if(p[1]==='step'&&p.length===3)advance(s,Number(p[2]));
  else if(p[1]==='repair'&&p.length===2)action(s,{type:'repair-all'});
  else if(p[1]==='submit'&&p.length===4)action(s,{type:'submit',nodes:Number(p[2]),steps:Number(p[3]),name:'terminal-job'});
  else if(['drain','resume'].includes(p[1])&&p.length===3)action(s,{type:p[1],node:p[2]});
  else if(p[1]==='fault'&&p[2]==='rail'&&p.length===4)action(s,{type:'fault',kind:'rail',index:Number(p[3])-1});
  else if(p[1]==='requeue'&&p.length===3)action(s,{type:'requeue',id:Number(p[2])});
  else throw new Error('Unsupported simulator command. Type help.');return 'Virtual model updated at logical second '+s.time+'.';
 }
 return 'Command not implemented in this simulator. Type help; no command is executed on a host.';
}
export function snapshot(s){return JSON.stringify({format:'wirewalk-cluster-simulator',version:1,state:s},null,2)}
export function restore(text){
 assert(typeof text==='string'&&text.length<1000000,'Session file must be smaller than 1 MB.');const packet=JSON.parse(text);assert(packet?.format==='wirewalk-cluster-simulator'&&packet.version===1,'Not a supported Wirewalk session.');const x=packet.state;assert(x&&typeof x==='object','Invalid session state.');const s=createCluster(configuration(x.config));
 const bool=(v,label)=>{assert(typeof v==='boolean',label+' must be true/false.');return v};const str=(v,max,label)=>{assert(typeof v==='string'&&v.length<=max,label+' is invalid.');return v};const num=(v,min,max,label)=>{assert(typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max,label+' is invalid.');return v};
 s.time=bounded(x.time,0,10000000,'Invalid clock.');s.rng=bounded(x.rng,0,4294967295,'Invalid RNG state.');s.nextEvent=bounded(x.nextEvent,1,100000000,'Invalid event sequence.');s.nextJob=bounded(x.nextJob,1001,1000000,'Invalid job sequence.');s.started=bool(x.started,'started');s.managementUp=bool(x.managementUp,'managementUp');s.headAUp=bool(x.headAUp,'headAUp');s.headBUp=bool(x.headBUp,'headBUp');assert(['head-a','head-b'].includes(x.head),'Invalid head role.');s.head=x.head;s.headFailover=bounded(x.headFailover,0,3,'Invalid head failover.');s.slots=bounded(x.slots,1,16,'Invalid provisioning slots.');s.ecn=bool(x.ecn,'ecn');assert(['gpu-v1','gpu-v2'].includes(x.categoryImage),'Invalid category image.');s.categoryImage=x.categoryImage;
 assert(Array.isArray(x.images)&&x.images.length===2,'Invalid images.');s.images=x.images.map((im,i)=>{assert(im.id===s.images[i].id,'Invalid image identity.');return{id:im.id,driverReady:bool(im.driverReady,'driverReady'),locked:bool(im.locked,'locked')}});
 assert(Array.isArray(x.nodes)&&x.nodes.length===s.nodes.length,'Invalid node count.');s.nodes=x.nodes.map((n,i)=>{assert(n.id===s.nodes[i].id&&STAGES.includes(n.stage),'Invalid node identity/state.');assert(['gpu-v1','gpu-v2'].includes(n.targetImage)&&[null,'gpu-v1','gpu-v2'].includes(n.image),'Invalid node image.');return{id:n.id,stage:n.stage,stageTime:bounded(n.stageTime,0,10000000,'Invalid stage time.'),targetImage:n.targetImage,image:n.image,driverReady:bool(n.driverReady,'driverReady'),drained:bool(n.drained,'drained'),gpuFault:bool(n.gpuFault,'gpuFault'),railMismatch:bool(n.railMismatch,'railMismatch'),mounted:bool(n.mounted,'mounted'),reason:str(n.reason,500,'node reason')}});
 assert(Array.isArray(x.rails)&&x.rails.length===8,'Eight rails are required.');s.rails=x.rails.map((r,i)=>{assert(r.id===i&&typeof r.txUnits==='string'&&/^\d{1,35}$/.test(r.txUnits),'Invalid rail/counter.');return{id:i,up:bool(r.up,'rail up'),util:num(r.util,0,100,'utilization'),txUnits:r.txUnits,errors:bounded(r.errors,0,10000000,'Invalid error count.')}});
 assert(Array.isArray(x.bondMembers)&&x.bondMembers.length===2,'Two bond members required.');s.bondMembers=x.bondMembers.map(v=>bool(v,'bond member'));assert(x.storage&&Array.isArray(x.storage.servers)&&x.storage.servers.length===4,'Four storage services required.');s.storage={servers:x.storage.servers.map(v=>bool(v,'storage server')),activeMds:bounded(x.storage.activeMds,0,1,'Invalid MDS.'),failover:bounded(x.storage.failover,0,3,'Invalid failover.')};
 assert(Array.isArray(x.jobs)&&x.jobs.length<=40,'Invalid jobs.');const ids=new Set(),allocated=new Set();s.jobs=x.jobs.map(j=>{bounded(j.id,1001,999999,'Invalid job ID.');assert(!ids.has(j.id),'Duplicate job ID.');ids.add(j.id);assert(['PENDING','RUNNING','FAILED','COMPLETED','CANCELLED'].includes(j.state)&&['PENDING','STAGING','COMPUTE','CHECKPOINT','FINALIZING','FAILED','COMPLETED','CANCELLED'].includes(j.phase),'Invalid job state.');const nodes=bounded(j.nodes,1,s.nodes.length,'Invalid job nodes.'),steps=bounded(j.steps,20,2000,'Invalid work units.');assert(Array.isArray(j.allocated)&&j.allocated.length===(j.state==='RUNNING'?nodes:0),'Invalid allocation length.');for(const id of j.allocated){assert(s.nodes.some(n=>n.id===id)&&!allocated.has(id),'Invalid/overlapping allocation.');allocated.add(id)}return{id:j.id,name:str(j.name,40,'job name'),nodes,steps,state:j.state,phase:j.phase,progress:num(j.progress,0,steps,'progress'),checkpoint:num(j.checkpoint,0,j.progress,'checkpoint'),phaseWork:num(j.phaseWork,0,100000,'phase work'),allocated:[...j.allocated],reason:str(j.reason,500,'job reason'),waiting:bool(j.waiting,'waiting')}});assert(!s.jobs.some(j=>j.id>=s.nextJob),'Job sequence is inconsistent.');
 assert(Array.isArray(x.events)&&x.events.length<=100,'Invalid event history.');s.events=x.events.map(e=>{assert(['info','good','warn','bad'].includes(e.kind),'Invalid severity.');return{id:bounded(e.id,1,s.nextEvent,'Invalid event ID.'),time:bounded(e.time,0,s.time,'Invalid event time.'),kind:e.kind,message:str(e.message,700,'event message')}});
 assert(Array.isArray(x.history)&&x.history.length<=90,'Invalid metric history.');s.history=x.history.map(h=>({time:bounded(h.time,0,s.time,'Invalid metric time.'),ready:bounded(h.ready,0,s.nodes.length,'Invalid ready metric.'),jobs:bounded(h.jobs,0,40,'Invalid jobs metric.'),railUtil:num(h.railUtil,0,100,'Invalid rail metric.'),storage:bounded(h.storage,0,1,'Invalid storage metric.')}));health(s);return s;
}
