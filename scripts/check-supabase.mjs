import {SupabaseStore} from '../worker/storage/supabase.mjs';
import {ApiError} from '../worker/errors.mjs';
import {formatSupabaseDiagnostic} from './supabase-diagnostic.mjs';
try {
  const db=new SupabaseStore(process.env);
  const events=await db.listEvents('__connection_check__','');
  if(!Array.isArray(events)) throw new ApiError('La fonction campus_list_events ne renvoie pas une liste.',502);
  console.log('Connexion Supabase et fonction campus_list_events vérifiées. Aucune donnée modifiée.');
} catch(error) {
  console.error(formatSupabaseDiagnostic(error));
  process.exitCode=1;
}
