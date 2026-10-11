import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {init,loadTrip,write,inside,dayHash,now,hash} from './lib/core.mjs';
import {importSource,digest} from './lib/research.mjs';
import {scaffoldRoutes,routeReview} from './lib/maps-weather.mjs';
import {routeHash,read} from './lib/core.mjs';

export function makeDemo(project){
  init(project,'虚构海湾之旅 · 仅供功能演示','2027-05-01','2027-05-02');
  const trip=loadTrip(project);
  trip.referenceCurrency='CNY';trip.rates={DEM:{rate:2,asOf:'2027-04-01',source:'https://example.com/demo-rate'}};
  trip.places=[
    {id:'demo-stay',name:'演示住宿',address:'虚构城市 演示路1号（不可导航）',kind:'hotel',private:true,description:'虚构示例，不是真实住宿。'},
    {id:'demo-museum',name:'海湾博物馆',address:'虚构城市 博物馆正门（不可导航）',kind:'attraction',description:'示例：用一座港口的船与器物认识城市。不是实际景点介绍。'},
    {id:'demo-table',name:'潮汐餐桌',address:'虚构城市 港口街2号（不可导航）',kind:'restaurant',aliases:['潮汐餐厅'],description:'演示餐厅卡，展示菜单预算与关联订单。'},
    {id:'demo-market',name:'街角超市',address:'虚构城市 社区路3号（不可导航）',kind:'supermarket'}
  ].map(p=>({...p,mapUrl:'https://example.com/places/'+p.id,review:{by:'synthetic-fixture',at:now(),evidence:'Synthetic data, no geographical verification'}}));
  trip.catalog=[
    {id:'food',name:'潮汐餐桌',placeId:'demo-table',city:'虚构海湾',kind:'restaurant',cuisine:'演示本地菜',price:{currency:'DEM',min:50,max:80,basis:'person'},openingHours:'演示：12:00–20:00；不是真实营业',verifiedAt:'2027-04-01',url:'https://example.com/menu'},
    {id:'market',name:'街角超市',placeId:'demo-market',city:'虚构海湾',kind:'supermarket',openingHours:'演示：08:00–21:00',verifiedAt:'2027-04-01',url:'https://example.com/market'}
  ];
  write(inside(project,'private/demo-order.txt'),'SYNTHETIC TEST ORDER. No real reservation or payment.');
  trip.orders=[{id:'order-one',title:'虚构午餐订单',category:'restaurant',date:trip.start,start:'12:00',end:'13:00',party:3,placeId:'demo-table',status:'booked',amount:{currency:'DEM',min:180,max:180},evidence:'private/demo-order.txt',instructions:'仅用于测试订单投影，不是实际订位。',cancelRule:'虚构规则，无实际取消链接'}];
  trip.todos=[{id:'review-weather',dates:[trip.start,trip.end],kind:'weather',when:'各活动前一天',action:'复查天气并决定是否去海湾博物馆',status:'open'}];
  trip.days.forEach((d,i)=>{
    Object.assign(d,{city:'虚构海湾',timezone:'Europe/Oslo',party:i?2:3,stayId:'demo-stay',summary:'海湾博物馆 → 潮汐餐桌 → 街角超市 → 回住宿',weatherIds:['bay','hill']});
    d.timeline=[{start:'09:00',end:'09:30',title:'早餐后从演示住宿出发',placeId:'demo-stay'},{start:'10:00',end:'11:30',title:'参观海湾博物馆',placeId:'demo-museum'},{start:'12:00',end:'13:00',title:'潮汐餐桌午餐',placeId:'demo-table'},{start:'16:00',end:'16:30',title:'街角超市补给',placeId:'demo-market'},{start:'17:00',end:'18:00',title:'回演示住宿休息',placeId:'demo-stay'}];
    d.meals=[{meal:'lunch',role:'default',catalogId:'food',...(i?{}:{orderId:'order-one'})},{meal:'dinner',role:'default',note:'使用今天采购的食材自炊',cost:{currency:'DEM',min:20,max:30,basis:'person'}},{meal:'grocery',role:'alternative',catalogId:'market',note:'采购费用已包含在自炊估算，勿重复计费'}];
  });
  trip.weatherLocations=[{id:'bay',name:'演示湾区',latitude:60,longitude:5,timezone:'Europe/Oslo'},{id:'hill',name:'演示山地',latitude:60.1,longitude:5.1,timezone:'Europe/Oslo'}];
  trip.knowledge=[{id:'demo-guide',title:'示例：海湾的一天',summary:'虚构Wiki，检验主题阅读与来源追溯。',city:'虚构海湾',path:'knowledge/demo.md'}];
  trip.guides=[{id:'guide',region:'示例国家',title:'到达与轻装游览',summary:'先安排行李，再开始步行。此为样例。',wikiId:'demo-guide'}];
  trip.shopping=[{id:'shop',region:'虚构海湾',title:'日用品采购',summary:'街角超市采购早餐；按当天安排决定。',wikiId:'demo-guide'}];
  trip.journal=trip.days.flatMap(d=>[
    {id:'intro-'+d.date,date:d.date,kind:'intro',title:'沿水岸，认识一座城',text:'这是一座虚构港口，供演示项目、餐饮、订单与手册如何共用事实。'},
    {id:'museum-'+d.date,date:d.date,kind:'experience',title:'看船与港口生活',text:'海湾博物馆用船和器物讲港口的故事。先看主展，再按体力补看其他区域；入馆、票价和参观时长应在真实旅行中单独核验。此段为虚构演示。',placeIds:['demo-museum']},
    {id:'table-'+d.date,date:d.date,kind:'experience',title:'在港口吃午餐',text:'潮汐餐桌是演示用的本地餐厅。菜单与人均价格看餐厅清单，具体预约看关联订单；不要把这份虚构订单当作实际订位。',placeIds:['demo-table']}
  ]);
  trip.researchCoverage=[{id:'coverage',city:'虚构海湾',topic:'动线',question:'怎样形成轻松的一天？',noteIds:['demo-source'],officialUrls:['https://example.com/guide'],gaps:['示例没有真实旅游证据'],target:3}];
  write(inside(project,'knowledge/demo.md'),'# 海湾的一天（虚构）\n\n这是一份功能样例，不是真实旅游结论。\n\n## 操作与边界\n\n海湾博物馆后去潮汐餐桌。所有地点和价格均为虚构。\n\n## 原始来源\n\n- [虚构来源](https://example.com/travel-note)：用于测试导入与消化链接，不是有效旅游经验。\n');
  write(inside(project,'trip.json'),trip);
  scaffoldRoutes(project,'walking');
  const updated=loadTrip(project);
  for(const r of updated.routes)routeReview(project,r.id,{routeHash:routeHash(updated,r),dayHash:dayHash(updated.days.find(d=>d.date===r.date)),by:'synthetic-test',at:now(),evidence:'Synthetic structure only, not live map',endpointsAndModeChecked:true});
  const final=loadTrip(project);for(const j of final.journal)j.reviewedBasis=dayHash(final.days.find(d=>d.date===j.date));write(inside(project,'trip.json'),final);
  importSource(project,{id:'demo-source',title:'虚构资料',url:'https://example.com/travel-note',text:'Synthetic fixture, not real tourism evidence.',images:[]},project);
  const row=read(inside(project,'research/registry.json'))[0];
  digest(project,{id:row.id,rawHash:row.rawHash,reviewer:'synthetic-test',reviewedAt:now(),status:'complete',bodyRead:true,images:[],outcomes:[{topic:'示例',reason:'测试来源链',file:'knowledge/demo.md'}]});
  const snapshot={fetchedAt:now(),synthetic:true,locations:final.weatherLocations.map((w,i)=>({...w,fetchedAt:now(),source:'https://example.com/forecast',forecastOnly:true,daily:final.days.map((d,j)=>({date:d.date,min:6+i+j,max:12+i+j,code:2,sunrise:d.date+'T06:00',sunset:d.date+'T20:30',daylightHours:14.5,rain:2,wind:15,gust:24}))})),failures:[]};
  const body=JSON.stringify(snapshot);write(inside(project,'weather/snapshots/demo.json'),body);write(inside(project,'weather/latest.json'),{file:'weather/snapshots/demo.json',hash:hash(body)});
  return {project,synthetic:true,warning:'No real places, reservations, rates or forecasts. Missing map images intentionally stay visible.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{if(process.argv[2]!=='--project'||!process.argv[3])throw Error('Usage: node scripts/make-demo.mjs --project NEW_DIRECTORY');console.log(JSON.stringify(makeDemo(path.resolve(process.argv[3])),null,2));}catch(e){console.error(e.message);process.exitCode=1;}
}
