import http from 'k6/http';
import {check,sleep} from 'k6';
import {Counter,Rate,Trend} from 'k6/metrics';
const failures=new Rate('data_failures'),rows=new Counter('rows_read'),latency=new Trend('list_latency');
export const options={vus:5,duration:'10s',thresholds:{http_req_failed:['rate<0.01'],data_failures:['rate==0'],list_latency:['p(95)<500','p(99)<1500']}};
export default function(){
  const url=__ENV.XIRANG_TEST_API;if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(url))throw new Error('Loopback test API required');
  const health=http.get(url+'/health'),list=http.get(url+'/tasks?pageSize=20',{headers:{authorization:'Bearer '+__ENV.XIRANG_TEST_TOKEN}});
  const good=check(health,{'health body':r=>r.status===200&&r.json('status')==='ok'})&&check(list,{'bounded rows and total':r=>r.status===200&&r.json('items').length===20&&r.json('total')===1000});
  failures.add(!good);if(good)rows.add(20);latency.add(list.timings.duration);sleep(0.1);
}
