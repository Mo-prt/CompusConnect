import {SupabaseStore} from '../worker/storage/supabase.mjs';
try {
  const db=new SupabaseStore(process.env);
  const events=await db.listEvents('__connection_check__','');
  if(!Array.isArray(events)) throw new Error('La fonction campus_list_events ne renvoie pas une liste.');
  console.log('Connexion Supabase et fonction campus_list_events vérifiées. Aucune donnée modifiée.');
} catch(error) {
  console.error(error.message);
  process.exitCode=1;
}
