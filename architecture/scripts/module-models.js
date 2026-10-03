// Semantic module tables (ADR-035): one declaration generates Prisma schema, SQL for every engine and Drizzle schema.
// Field: [key, type, comment, options]; type id|string|long|boolean|date|int; options optional/default/unique/ref/index.
const snake=key=>key.replace(/[A-Z]/g,c=>'_'+c.toLowerCase());
const AUDIT={
 createdAt:['date','创建时间',{default:'now'}],updatedAt:['date','最后修改时间',{updated:true}],
 createdBy:['string','创建人标识，无登录主体时为 system',{default:'system'}],updatedBy:['string','最后修改人标识，无登录主体时为 system',{default:'system'}],
 deletedAt:['date','软删除时间，为空表示未删除',{optional:true}],deletedBy:['string','软删除操作人标识',{optional:true}]
};
const audit=(soft)=>Object.entries(AUDIT).filter(([k])=>soft||!k.startsWith('deleted')).map(([k,[type,comment,options]])=>[k,type,comment,options]);
const HARD='物理删除：每次删除写入 auth_audit_log（只记模型、ID、用户与操作者）';
const models={
 auth:[
  {key:'user',model:'User',table:'user',soft:true,comment:'用户：登录主体，删除为软删除',live:'email',fields:[
   ['id','id','用户 ID'],['name','string','显示名称'],['email','string','登录邮箱，未删除用户内唯一'],
   ['emailVerified','boolean','邮箱是否已验证：true=已验证 false=未验证',{default:false}],['image','long','头像地址',{optional:true}]],
   relations:['sessions Session[]','accounts Account[]','members Member[]','invitations Invitation[]']},
  {key:'session',model:'Session',table:'session',hard:'会话到期或登出即失效，'+HARD,comment:'登录会话：令牌短期有效，物理删除并留审计',fields:[
   ['id','id','会话 ID'],['expiresAt','date','过期时间'],['token','string','会话令牌（敏感，禁止写入日志）',{unique:true}],
   ['ipAddress','string','登录 IP',{optional:true}],['userAgent','long','客户端标识',{optional:true}],
   ['userId','string','所属用户 ID',{ref:'user',index:true}],['activeOrganizationId','string','当前活动组织 ID',{optional:true}]]},
  {key:'account',model:'Account',table:'account',hard:'凭据随用户删除或解绑清除，'+HARD,comment:'登录凭据：密码哈希与第三方令牌，物理删除并留审计',fields:[
   ['id','id','凭据 ID'],['accountId','string','提供方内的账号 ID'],['providerId','string','认证提供方：credential=邮箱密码，其余为 OAuth 提供方'],
   ['userId','string','所属用户 ID',{ref:'user',index:true}],['accessToken','long','访问令牌（敏感）',{optional:true}],['refreshToken','long','刷新令牌（敏感）',{optional:true}],
   ['idToken','long','身份令牌（敏感）',{optional:true}],['accessTokenExpiresAt','date','访问令牌过期时间',{optional:true}],['refreshTokenExpiresAt','date','刷新令牌过期时间',{optional:true}],
   ['scope','long','授权范围',{optional:true}],['password','long','密码哈希（敏感）',{optional:true}]]},
  {key:'verification',model:'Verification',table:'verification',hard:'验证码使用或过期即失效，'+HARD,comment:'验证记录：邮箱验证、重置密码等一次性凭证',fields:[
   ['id','id','验证记录 ID'],['identifier','string','验证对象标识',{index:true}],['value','long','验证值（敏感）'],['expiresAt','date','过期时间']]},
  {key:'organization',model:'Organization',table:'organization',soft:true,comment:'组织：多成员租户，删除为软删除',live:'slug',fields:[
   ['id','id','组织 ID'],['name','string','组织名称'],['slug','string','组织短标识，未删除组织内唯一'],['logo','long','组织标志地址',{optional:true}],['metadata','long','扩展元数据（JSON 文本）',{optional:true}]],
   relations:['members Member[]','invitations Invitation[]']},
  {key:'member',model:'Member',table:'member',soft:true,comment:'组织成员：用户在组织中的角色，删除为软删除',fields:[
   ['organizationId','string','所属组织 ID',{ref:'organization',index:true}],['userId','string','成员用户 ID',{ref:'user',index:true}],['role','string','成员角色：owner=所有者 admin=管理员 member=成员',{default:'member'}]],idFirst:'成员记录 ID'},
  {key:'invitation',model:'Invitation',table:'invitation',soft:true,comment:'组织邀请：待接受的成员邀请，删除为软删除',fields:[
   ['organizationId','string','所属组织 ID',{ref:'organization',index:true}],['email','string','受邀邮箱',{index:true}],['role','string','邀请角色：owner=所有者 admin=管理员 member=成员',{optional:true}],
   ['status','string','邀请状态：pending=待处理 accepted=已接受 rejected=已拒绝 canceled=已取消',{default:'pending'}],['expiresAt','date','过期时间'],['inviterId','string','邀请人用户 ID',{ref:'user',relation:'user'}]],idFirst:'邀请 ID'},
  {key:'authAuditLog',model:'AuthAuditLog',table:'auth_audit_log',hard:'只追加的身份删除审计日志，不更新不删除',comment:'身份审计日志：会话、凭据、验证记录的物理删除记录（不含令牌、密码与验证值）',fields:[
   ['id','id','日志 ID'],['action','string','操作：delete=物理删除'],['targetModel','string','目标模型：session=会话 account=凭据 verification=验证记录'],
   ['targetId','string','目标记录 ID'],['userId','string','关联用户 ID',{optional:true}],['actor','string','操作者标识，无登录主体时为 system']],index:[['targetModel','targetId']]}
 ],
 files:[
  {key:'fileObject',model:'FileObject',table:'file_object',soft:true,comment:'文件元数据：对象存储中的文件记录，删除为软删除',fields:[
   ['id','id','文件 ID'],['ownerId','string','所有者标识'],['storeId','string','存储配置 ID'],['objectKey','key','对象键，同一存储内永久唯一（删除后不复用）'],
   ['state','string','文件状态：pending=待上传 uploading=上传中 completing=完成中 ready=可用 cancelled=已取消 deleting=删除中 deleted=已删除'],['version','int','乐观锁版本号，每次更新加 1'],['record','long','完整文件记录（JSON 文本）']],
   unique:[['storeId','objectKey']],index:[['ownerId','id'],['state','updatedAt']]}
 ]
};
function tables(kind){
 return models[kind].map(m=>{
  const fields=[...(m.idFirst?[['id','id',m.idFirst]]:[]),...m.fields,...audit(!!m.soft)].map(([key,type,comment,options={}])=>({key,column:snake(key),type,comment,...options}));
  return {...m,fields};
 });
}
const flavor=engine=>['mysql','mariadb'].includes(engine)?'mysql':engine;
// Prisma -------------------------------------------------------------------
function prismaType(f,engine){
 const base={id:'String',string:'String',key:'String',long:'String',boolean:'Boolean',date:'DateTime',int:'Int'}[f.type];
 let out=base+(f.optional?'?':'');
 const attrs=[];
 if(f.type==='id')attrs.push('@id');
 if(f.unique)attrs.push('@unique');
 if(f.default==='now')attrs.push('@default(now())');else if(f.default===false)attrs.push('@default(false)');else if(f.default!==undefined)attrs.push(`@default(${typeof f.default==='number'?f.default:JSON.stringify(f.default)})`);
 if(f.updated)attrs.push('@updatedAt');
 if(f.column!==f.key)attrs.push(`@map("${f.column}")`);
 if(flavor(engine)==='mysql'&&f.type==='long')attrs.push('@db.LongText');
 if(flavor(engine)==='mysql'&&f.type==='key')attrs.push('@db.VarChar(512)');
 return [out,...attrs].join(' ');
}
const refModel={user:'User',organization:'Organization'};
// mode: partial (PostgreSQL/SQLite partial unique), plain (existing schema without partialIndexes), mysql (generated column)
function prismaSchema(kind,engine,{partial=true}={}){
 const my=flavor(engine)==='mysql';
 let out=kind==='auth'?'// Better Auth 1.7.3: email/password, organization and bearer plugins. Project owned after initialization.\n':'// Project-owned file metadata. Change with an append-only migration.\n';
 out+='// 数据语义约定（ADR-035）：表/列 snake_case（@map/@@map），注释、审计字段与删除策略见迁移 SQL 与 docs/data/dictionary.md。\n';
 for(const m of tables(kind)){
  const lines=[];
  for(const f of m.fields){lines.push(`  /// ${f.comment}`,`  ${f.key} ${prismaType(f,engine)}`);if(f.ref)lines.push(`  ${f.relation||f.ref} ${refModel[f.ref]} @relation(fields: [${f.key}], references: [id], onDelete: Cascade)`);}
  if(m.live&&my){const live=m.live+'Active';lines.push(`  /// 未删除时等于 ${m.live}，已删除为空；数据库存储生成列，只读`,`  ${live} String? @map("${snake(live)}")`);}
  for(const r of m.relations||[])lines.push('  '+r);
  if(m.live)lines.push(my?`  @@unique([${m.live}Active])`:partial?`  @@unique([${m.live}], where: { deletedAt: null })`:`  @@unique([${m.live}])`);
  for(const u of m.unique||[])lines.push(`  @@unique([${u.join(', ')}])`);
  for(const f of m.fields.filter(f=>f.index))lines.push(`  @@index([${f.key}])`);
  for(const i of m.index||[])lines.push(`  @@index([${i.join(', ')}])`);
  lines.push(`  @@map("${m.table}")`);
  out+=`\n/// ${m.comment}\nmodel ${m.model} {\n${lines.join('\n')}\n}\n`;
 }
 return out;
}
// SQL ------------------------------------------------------------------------
const quote=(engine,name)=>flavor(engine)==='mysql'?'`'+name+'`':'"'+name+'"';
const text=s=>"'"+s.replaceAll("'","''")+"'";
function sqlType(f,engine){
 const fl=flavor(engine);
 if(f.type==='boolean')return 'BOOLEAN';
 if(f.type==='int')return 'INTEGER';
 if(f.type==='date')return fl==='postgres'?'TIMESTAMP(3)':fl==='mysql'?'DATETIME(3)':'DATETIME';
 if(fl!=='mysql')return 'TEXT';
 return f.type==='long'?'LONGTEXT':f.type==='key'?'VARCHAR(512)':'VARCHAR(191)';
}
function sqlColumn(f,engine){
 const fl=flavor(engine);
 let s=`  ${quote(engine,f.column)} ${sqlType(f,engine)} ${f.optional?(fl==='mysql'?'NULL':''):'NOT NULL'}`.trimEnd();
 if(f.type==='id')s+=' PRIMARY KEY';
 if(f.default==='now')s+=' DEFAULT '+(fl==='mysql'?'CURRENT_TIMESTAMP(3)':'CURRENT_TIMESTAMP');
 else if(f.default===false)s+=' DEFAULT false';
 else if(f.default!==undefined)s+=' DEFAULT '+(typeof f.default==='number'?f.default:text(f.default));
 if(fl==='mysql')s+=' COMMENT '+text(f.comment);
 return s;
}
function moduleSQL(kind,engine,{partial=true}={}){
 const fl=flavor(engine),q=name=>quote(engine,name),list=cols=>cols.map(q).join(fl==='mysql'?',':', ');
 const ts=tables(kind),col=(m,key)=>m.fields.find(f=>f.key===key).column;
 let out=kind==='auth'?'-- Better Auth 1.7.3 身份表：数据语义约定（ADR-035），软删除表过滤未删除行，会话/凭据/验证物理删除并写 auth_audit_log\n':'-- 文件元数据表：数据语义约定（ADR-035），删除为软删除，对象键不复用\n';
 for(const m of ts.filter(m=>m.hard))out+=`-- xirang:hard-delete ${m.table} ${m.hard}\n`;
 const indexes=[],comments=[];
 for(const m of ts){
  const body=m.fields.map(f=>sqlColumn(f,engine));
  if(m.live&&fl==='mysql'){const live=m.live+'Active';body.push(`  ${q(snake(live))} VARCHAR(191) GENERATED ALWAYS AS (IF(${q('deleted_at')} IS NULL, ${q(col(m,m.live))}, NULL)) STORED NULL COMMENT ${text(`未删除时等于 ${m.live}，已删除为空（唯一约束用）`)}`);}
  for(const f of m.fields.filter(f=>f.ref))body.push(`  CONSTRAINT ${q(m.table+'_'+f.column+'_fkey')} FOREIGN KEY (${q(f.column)}) REFERENCES ${q(f.ref)} (${q('id')}) ON DELETE CASCADE ON UPDATE CASCADE`);
  out+=`CREATE TABLE ${q(m.table)} (\n${body.join(',\n')}\n)${fl==='mysql'?' COMMENT='+text(m.comment):''};\n`;
  const unique=(name,cols,where)=>indexes.push(`CREATE UNIQUE INDEX ${q(name)} ON ${q(m.table)}(${list(cols)})${where?' WHERE '+where:''};`);
  for(const f of m.fields.filter(f=>f.unique))unique(m.table+'_'+f.column+'_key',[f.column]);
  if(m.live){const c=col(m,m.live);if(fl==='mysql')unique(m.table+'_'+snake(m.live+'Active')+'_key',[snake(m.live+'Active')]);else unique(m.table+'_'+c+'_key',[c],partial?`(${q('deleted_at')} IS NULL)`:'');}
  for(const u of m.unique||[]){const cols=u.map(k=>col(m,k));unique(m.table+'_'+cols.join('_')+'_key',cols);}
  for(const cols of [...m.fields.filter(f=>f.index).map(f=>[f.column]),...(m.index||[]).map(i=>i.map(k=>col(m,k)))])indexes.push(`CREATE INDEX ${q(m.table+'_'+cols.join('_')+'_idx')} ON ${q(m.table)}(${list(cols)});`);
  if(fl==='postgres'){comments.push(`COMMENT ON TABLE ${q(m.table)} IS ${text(m.comment)};`);for(const f of m.fields)comments.push(`COMMENT ON COLUMN ${q(m.table)}.${q(f.column)} IS ${text(f.comment)};`);}
 }
 return out+indexes.join('\n')+'\n'+(comments.length?comments.join('\n')+'\n':'');
}
// Drizzle --------------------------------------------------------------------
function drizzleModuleSchema(kind,engine){
 const fl=flavor(engine),isPg=fl==='postgres',isMy=fl==='mysql';
 const core=isPg?'pg':isMy?'mysql':'sqlite',table=isPg?'pgTable':isMy?'mysqlTable':'sqliteTable';
 const ts=tables(kind),lives=ts.some(m=>m.live);
 const imports=isPg?'pgTable,text,integer,boolean,timestamp,index,uniqueIndex':isMy?'mysqlTable,varchar,longtext,int,boolean,datetime,index,uniqueIndex':'sqliteTable,text,integer,index,uniqueIndex';
 const orm=[...(lives&&isMy?['sql']:[]),...(lives&&!isMy?['isNull']:[])];
 let out=`import {${imports}} from 'drizzle-orm/${core}-core';\n${orm.length?`import {${orm.join(',')}} from 'drizzle-orm';\n`:''}// Project-owned schema. Generate and review an append-only migration after changes.\n// 数据语义约定（ADR-035）：表/列 snake_case 与注释，db:generate 把注释写入迁移；@hard-delete 声明物理删除表。\n`;
 for(const m of ts){
  const cols=m.fields.map(f=>{
   let v;
   if(f.type==='date')v=isPg?`timestamp('${f.column}',{withTimezone:true,mode:'date'})`:isMy?`datetime('${f.column}',{mode:'date',fsp:3})`:`integer('${f.column}',{mode:'timestamp_ms'})`;
   else if(f.type==='int')v=`${isMy?'int':'integer'}('${f.column}')`;
   else if(f.type==='boolean')v=isPg||isMy?`boolean('${f.column}')`:`integer('${f.column}',{mode:'boolean'})`;
   else v=isMy?(f.type==='long'?`longtext('${f.column}')`:`varchar('${f.column}',{length:${f.type==='key'?512:191}})`):`text('${f.column}')`;
   if(f.type==='id')v+='.primaryKey()';
   if(!f.optional)v+='.notNull()';
   if(f.unique)v+='.unique()';
   if(f.default==='now')v+='.$defaultFn(()=>new Date())';else if(f.default!==undefined)v+=`.default(${JSON.stringify(f.default)})`;
   if(f.updated)v+='.$defaultFn(()=>new Date()).$onUpdate(()=>new Date())';
   if(f.ref)v+=`.references(()=>${f.ref}.id,{onDelete:'cascade'})`;
   return `  /** ${f.comment} */\n  ${f.key}:${v}`;
  });
  if(m.live&&isMy){const c=m.fields.find(f=>f.key===m.live).column;cols.push(`  /** 未删除时等于 ${m.live}，已删除为空（唯一约束用） */\n  ${m.live}Active:varchar('${snake(m.live+'Active')}',{length:191}).generatedAlwaysAs(sql\`if(deleted_at is null, ${c}, null)\`,{mode:'stored'})`);}
  const extras=[];
  if(m.live)extras.push(isMy?`uniqueIndex('${m.table}_${snake(m.live+'Active')}_key').on(t.${m.live}Active)`:`uniqueIndex('${m.table}_${snake(m.live)}_key').on(t.${m.live}).where(isNull(t.deletedAt))`);
  for(const u of m.unique||[])extras.push(`uniqueIndex('${m.table}_${u.map(snake).join('_')}_key').on(${u.map(k=>'t.'+k).join(',')})`);
  for(const keys of [...m.fields.filter(f=>f.index).map(f=>[f.key]),...(m.index||[])])extras.push(`index('${m.table}_${keys.map(snake).join('_')}_idx').on(${keys.map(k=>'t.'+k).join(',')})`);
  out+=`/** ${m.comment}${m.hard?`\n * @hard-delete ${m.hard}`:''} */\nexport const ${m.key}=${table}('${m.table}',{\n${cols.join(',\n')}\n}${extras.length?`,t=>[${extras.join(',')}]`:''});\n`;
 }
 return out;
}
module.exports={models,tables,prismaSchema,moduleSQL,drizzleModuleSchema,snake};
