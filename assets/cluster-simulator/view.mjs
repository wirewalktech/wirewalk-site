// Read-only presentation helpers. Hosted state is authoritative.
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
export function summary(s){
 const up=s.nodes.filter(n=>n.stage==='UP').length,ready=s.nodes.filter(n=>!nodeIssues(s,n).length).length,allocated=s.jobs.filter(j=>j.state==='RUNNING').reduce((v,j)=>v+j.allocated.length,0);return{up,ready,allocated,total:s.nodes.length,gpus:s.nodes.length*8,activeJobs:s.jobs.filter(j=>j.state==='RUNNING').length,pendingJobs:s.jobs.filter(j=>j.state==='PENDING').length,railsUp:s.rails.filter(r=>r.up).length,bond:bondStatus(s),storage:storageStatus(s),provisioning:s.nodes.filter(n=>['BOOTING','INSTALLING','INSTALLER_CALLINGINIT'].includes(n.stage)).length};
}
