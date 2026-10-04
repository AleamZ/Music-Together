import { foods, type Food } from './foods';
import { createFoodSelector, priceRarity } from './case-mechanics';
import { drinkRarity } from './drinks';
/** Which case a pool belongs to: food (default) or drinks. Both share one cookie format. */
export type PoolKind = 'food' | 'drink';
export type CustomFood = { id: string; name: string; price: number; veg: boolean };
export type PoolProfile = { disabled: number[]; custom: CustomFood[]; revision: number };
export const emptyProfile = (): PoolProfile => ({ disabled: [], custom: [], revision: 0 });
export function validateProfile(input: unknown, catalog: Food[] = foods): PoolProfile {
 const ids = new Set(catalog.map(f => f.image));
 if (!input || typeof input !== 'object') throw new Error('Invalid profile');
 const p = input as Record<string, unknown>;
 if (Object.keys(p).some(k => !['disabled','custom','revision'].includes(k)) || !Array.isArray(p.disabled) || !Array.isArray(p.custom) || !Number.isSafeInteger(p.revision) || (p.revision as number)<0) throw new Error('Invalid profile');
 if (p.disabled.length>catalog.length || p.custom.length>50 || new Set(p.disabled).size!==p.disabled.length || p.disabled.some(id=>!ids.has(id))) throw new Error('Invalid dishes');
 const custom = p.custom.map((item: unknown): CustomFood => {
  if (!item || typeof item!=='object') throw new Error('Invalid dish');
  const f=item as Record<string,unknown>;
  if(Object.keys(f).some(k=>!['id','name','price','veg'].includes(k)) || typeof f.id!=='string' || !/^[0-9a-f-]{36}$/i.test(f.id) || typeof f.name!=='string' || !f.name.trim() || f.name.length>60 || /[\x00-\x1f\x7f]/.test(f.name) || !Number.isInteger(f.price) || (f.price as number)<10 || (f.price as number)>500 || typeof f.veg!=='boolean') throw new Error('Invalid dish');
  return {id:f.id,name:f.name.trim().normalize('NFC'),price:f.price as number,veg:f.veg};
 });
 if(new Set(custom.map(f=>f.id)).size!==custom.length || catalog.length-p.disabled.length+custom.length<1) throw new Error('Keep at least one dish');
 return {disabled:p.disabled as number[],custom,revision:p.revision as number};
}
export function personalFoods(profile: PoolProfile, catalog: Food[] = foods, kind: PoolKind = 'food'): Food[] {
 if (kind === 'drink') return [...catalog.filter(f=>!profile.disabled.includes(f.image)), ...profile.custom.map(f=>({...f,customId:f.id,drink:true,image:-1,sub:'Đồ uống của tôi',quip:'',rarity:drinkRarity(f.price)}))];
 return [...catalog.filter(f=>!profile.disabled.includes(f.image)), ...profile.custom.map(f=>({...f,customId:f.id,image:-1,sub:'Món của tôi',quip:'',rarity:priceRarity(f.price)}))];
}
export function personalSelector(population: Food[], target: number) {
 if(!population.length) return null;
 const feasible=Math.max(Math.min(...population.map(f=>f.price)),Math.min(target,Math.max(...population.map(f=>f.price))));
 return createFoodSelector(population,feasible);
}
