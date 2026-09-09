import { createServer } from 'node:http';
const port=Number(process.env.PORT||3000);
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid PORT');
createServer((req,res)=>{
  res.setHeader('content-type','application/json');
  res.statusCode=req.url==='/health'?200:404;
  res.end(JSON.stringify(req.url==='/health'?{status:'ok'}:{code:'NOT_FOUND'}));
}).listen(port,process.env.HOST||'127.0.0.1');
