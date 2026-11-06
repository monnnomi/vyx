export const tiers=[
 {name:'Spark',min:20,max:80}, {name:'Lunar',min:100,max:350},
 {name:'Mystic',min:400,max:1200}, {name:'Radiance',min:1500,max:5000}
];
export const quests=[];
export function calendar(now=new Date()) {
 const date=now.toISOString(), day=date.slice(0,10);
 const season=date<'2026-11-01'?'early-access':date<'2026-12-01'?'season-1':date<'2026-12-25'?'season-2':'post-season';
 return {day,season,label:{'early-access':'Early access','season-1':'Season 1 · November','season-2':'Season 2 · December','post-season':'Community season'}[season],farming:['season-1','season-2'].includes(season)};
}
export function publicUser(u) {
 if(!u)return null;
 return {id:u.id,name:u.name,handle:u.handle,bio:u.bio,avatar_url:u.avatar_url,is_system:u.is_system,
 x_username:u.x_username,created_at:u.created_at,profile_completed:u.profile_completed};
}
