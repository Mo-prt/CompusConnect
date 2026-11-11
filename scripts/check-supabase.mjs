import {SupabaseStore} from '../worker/storage/supabase.mjs';
import {ApiError} from '../worker/errors.mjs';
import {formatSupabaseDiagnostic} from './supabase-diagnostic.mjs';
const tables=['profiles','roles','user_roles','programs','departments','department_heads','semesters','modules','program_modules','timetables','timetable_sessions','classrooms','events','event_program_targets','event_registrations'];
const functions=['campus_existing_ensure_profile','campus_existing_save_event','campus_existing_register','campus_existing_cancel_event'];
try{
  const db=new SupabaseStore(process.env),schema=await db.schema();
  const missing=tables.filter(name=>!schema.definitions?.[name]);
  if(missing.length)throw new ApiError('Tables existantes introuvables ou non accessibles : '+missing.join(', '),503);
  if(schema.definitions.events.properties?.id?.format!=='uuid'||!schema.definitions.events.properties?.starts_at)throw new ApiError('La table events ne correspond pas au schéma CampusConnect existant attendu.',503);
  console.log('Connexion aux tables existantes de Supabase vérifiée. Aucune donnée modifiée.');
  const absent=functions.filter(name=>!schema.paths?.['/rpc/'+name]);
  if(absent.length)throw new ApiError('Fonctions complémentaires absentes : '+absent.join(', ')+'. Exécutez supabase/migrations/20261111000100_existing_schema.sql dans le SQL Editor.',503);
  console.log('Fonctions transactionnelles compatibles présentes. La connexion est prête.');
}catch(error){console.error(formatSupabaseDiagnostic(error));process.exitCode=1}
