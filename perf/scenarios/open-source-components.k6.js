import http from 'k6/http';
import {check,sleep} from 'k6';
export const options={vus:3,duration:'10s',thresholds:{http_req_failed:['rate<0.01'],http_req_duration:['p(95)<500','p(99)<1500'],checks:['rate==1']}};
export default function(){
 const response=http.get(__ENV.XIRANG_TEST_API+'/files',{headers:{Cookie:__ENV.XIRANG_TEST_COOKIE},tags:{name:'authenticated-file-list'}});
 check(response,{'authenticated response':r=>r.status===200,'one completed file':r=>{try{return r.json().items.length===1&&r.json().items[0].state==='ready';}catch{return false;}}});
 sleep(0.05);
}
