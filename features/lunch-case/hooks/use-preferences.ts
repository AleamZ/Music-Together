import {useEffect,useState} from 'react';
/* Ported as-is from truanayangi: cookie state is read after mount (SSR has no cookies). */
/* eslint-disable react-hooks/set-state-in-effect */
import {emptyProfile,validateProfile,type PoolProfile} from '@/features/lunch-case/lib/personal-pool';
import type {Food} from '@/features/lunch-case/lib/foods';
import {readCookie,writeCookie,clearCookie} from '@/features/lunch-case/lib/cookies';
function load(key:string,catalog?:Food[]){try{return validateProfile(readCookie(key),catalog)}catch{return emptyProfile()}}
/** `key` is the cookie name; the drink case keeps its own pool next to the food one. */
export function usePreferences(key='pool',catalog?:Food[]){
 const [profile,setProfile]=useState<PoolProfile>(emptyProfile),[error,setError]=useState('');
 useEffect(()=>{setProfile(load(key,catalog))},[key,catalog]);
 const save=(next:PoolProfile)=>{try{const checked=validateProfile(next,catalog);writeCookie(key,checked);setProfile(checked);setError('');return true}catch(e){setError((e as Error).message);return false}};
 const reload=()=>{const next=load(key,catalog);setProfile(next);setError('');return next};
 const remove=()=>{try{clearCookie(key);setProfile(emptyProfile());setError('');return true}catch(e){setError((e as Error).message);return false}};
 return {profile,error,setError,save,reload,remove};
}
export type Preferences=ReturnType<typeof usePreferences>;
