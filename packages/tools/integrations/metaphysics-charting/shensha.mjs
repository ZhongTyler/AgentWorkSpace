// A separate, versioned table adapter. These are not lunar-javascript fields.
const stems='甲乙丙丁戊己庚辛壬癸';
const stemTable=values=>Object.fromEntries([...stems].map((s,i)=>[s,values[i]]));
const groups=[{branches:'申子辰',horse:'寅',peach:'酉',canopy:'辰',general:'子'},
  {branches:'寅午戌',horse:'申',peach:'卯',canopy:'戌',general:'午'},
  {branches:'巳酉丑',horse:'亥',peach:'午',canopy:'丑',general:'酉'},
  {branches:'亥卯未',horse:'巳',peach:'子',canopy:'未',general:'卯'}];
const book3='《三命通会》四库本卷三';
const primer='《滴天髓阐微》初学捷径';
export const shenshaRules=[
  {id:'tianyi',name:'天乙贵人',basis:'dayStem',table:stemTable(['丑未','子申','酉亥','酉亥','丑未','子申','丑未','寅午','卯巳','卯巳']),source:primer+'·PDF45–46',note:'日干查支；阴阳两贵并列，不划分昼夜得力。'},
  {id:'wenchang',name:'文昌贵人',basis:'dayStem',table:stemTable(['巳','午','申','酉','申','酉','亥','子','寅','卯']),source:primer+'·PDF46十干表',note:'采用此表；不与《三命》卷三的另一文昌歌混合。'},
  {id:'taiji',name:'太极贵人',basis:'dayStem',table:stemTable(['子午','子午','卯酉','卯酉','辰戌丑未','辰戌丑未','寅亥','寅亥','巳申','巳申']),source:book3+'·论太极贵',note:'仅标支位命中；不把一库命中等同原文四库全的条件。'},
  {id:'lu',name:'禄神',basis:'dayStem',table:stemTable(['寅','卯','巳','午','巳','午','申','酉','亥','子']),source:book3+'·论十干禄',note:'以本命日干查禄位；命中不等于禄能为用。'},
  {id:'jinyu',name:'金舆',basis:'dayStem',table:stemTable(['辰','巳','未','申','未','申','戌','亥','丑','寅']),source:book3+'·论金舆',note:'采用禄前二辰一说，不兼用马前二辰异说。'},
  {id:'blade',name:'阳刃',basis:'dayStem',table:{甲:'卯',丙:'午',戊:'午',庚:'酉',壬:'子'},source:book3+'·论羊刃末段',note:'只取五阳干。阴干羊刃另有不同表，本预设不混入。'},
  ...[['horse','驿马'],['peach','桃花'],['canopy','华盖'],['general','将星']].map(([id,name])=>({id,name,basis:'yearDayBranch',
    table:Object.fromEntries(groups.flatMap(g=>[...g.branches].map(b=>[b,g[id]]))),
    source:id==='horse'?book3+'·论驿马':'《三命通会》四库本卷二·'+(id==='peach'?'论咸池':'论将星华盖'),
    note:'本预设分别以本命年支、日支查支，并保留每个命中基准。'+(id==='peach'?'这里只筛支位；卷二另有纳音同类限定，未作为完整咸池成例。':'只标表项，不附加吉凶断语。')})),
  {id:'tiande',name:'天德贵人',basis:'monthBranch',table:{寅:'丁',卯:'申',辰:'壬',巳:'辛',午:'亥',未:'甲',申:'癸',酉:'寅',戌:'丙',亥:'乙',子:'巳',丑:'庚'},
    source:primer+'·PDF44表＋'+book3+'·论天月德',note:'按本命节气月支查干或支。坤/乾/艮/巽据卷三所载对应申/亥/寅/巳；不混用另一套逐月支法。'},
  {id:'yuede',name:'月德贵人',basis:'monthBranch',table:Object.fromEntries(groups.flatMap((g,i)=>[...g.branches].map(b=>[b,['壬','丙','庚','甲'][i]]))),
    source:book3+'·论天月德',note:'按本命节气月支查干；不混用原文另一套逐月支法。'}
];
export function shenshaFor(pillars,targets){
  const bases={dayStem:[{label:'本命日干',value:pillars.day.ganzhi[0]}],
    yearDayBranch:[{label:'本命年支',value:pillars.year.ganzhi[1]},{label:'本命日支',value:pillars.day.ganzhi[1]}],
    monthBranch:[{label:'本命月支（节气）',value:pillars.month.ganzhi[1]}]};
  return Object.fromEntries(Object.entries(targets).map(([key,p])=>[key,p?shenshaRules.flatMap(rule=>{
    const hits=bases[rule.basis].flatMap(base=>{const lookup=rule.table[base.value];if(!lookup)return[];
      const match=stems.includes(lookup)?p.ganzhi[0]:p.ganzhi[1];
      return lookup.includes(match)?[{...base,target:lookup,matched:match}]:[];
    });
    return hits.length?[{id:rule.id,name:rule.name,bases:hits}]:[];
  }):[]]));
}
export function shenshaView(pillars,flow){return{preset:'bazi-study-shensha-v1',scope:'12项常用表项；不是手机App全量神煞库',
  rules:shenshaRules.map(({table,...rule})=>rule),natal:shenshaFor(pillars,pillars),flow:shenshaFor(pillars,flow)};}
