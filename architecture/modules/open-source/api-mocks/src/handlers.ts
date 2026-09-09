import {http,HttpResponse} from 'msw';
// Project owned. Use an explicit API origin when adding business handlers.
export const handlers=[http.get('http://localhost:3000/health',()=>HttpResponse.json({status:'ok',mock:true}))];
