import {ApiError} from '../errors.mjs';
import {D1Store} from './d1.mjs';
import {SupabaseStore} from './supabase.mjs';

export function createStore(env) {
  const provider=env.DATA_BACKEND || (env.SUPABASE_URL ? 'supabase' : 'd1');
  if(provider==='supabase') return new SupabaseStore(env);
  if(provider!=='d1') throw new ApiError('DATA_BACKEND doit valoir d1 ou supabase.',503);
  if(!env.DB) throw new ApiError('La base de données est temporairement indisponible.',503);
  return new D1Store(env.DB);
}
