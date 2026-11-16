import {SupabaseStore} from '../worker/storage/supabase.mjs';
import {ApiError} from '../worker/errors.mjs';
import {formatSupabaseDiagnostic} from './supabase-diagnostic.mjs';
const tables=['profiles','roles','user_roles','programs','departments','department_heads','semesters','modules','program_modules','timetables','timetable_sessions','classrooms','events','event_program_targets','event_registrations'];
const functions=['campus_existing_ensure_profile','campus_existing_save_event','campus_existing_register','campus_existing_cancel_event'];
const serviceTables=['announcements','announcement_targets','course_documents','files','library_resources','library_resource_programs','complaints','complaint_messages','news_posts','lost_found_items','collaboration_spaces','collaboration_members','shared_resources','campus_locations','marketplace_listings','marketplace_categories','marketplace_images','marketplace_transactions','notifications','recommendations','recommendation_feedback','resource_views','chat_conversations','chat_messages','campus_role_requests','campus_discussions','campus_message_citations','campus_chat_feedback'];
const serviceFunctions=['campus_publish_announcement','campus_decide_role_request','campus_marketplace_request','campus_marketplace_decide','campus_marketplace_close'];
try{
  const db=new SupabaseStore(process.env),schema=await db.schema();
  const missing=tables.filter(name=>!schema.definitions?.[name]);
  if(missing.length)throw new ApiError('Tables existantes introuvables ou non accessibles : '+missing.join(', '),503);
  if(schema.definitions.events.properties?.id?.format!=='uuid'||!schema.definitions.events.properties?.starts_at)throw new ApiError('La table events ne correspond pas au schéma CampusConnect existant attendu.',503);
  console.log('Connexion aux tables existantes de Supabase vérifiée. Aucune donnée modifiée.');
  const absent=functions.filter(name=>!schema.paths?.['/rpc/'+name]);
  if(absent.length)throw new ApiError('Fonctions complémentaires absentes : '+absent.join(', ')+'. Exécutez supabase/migrations/20261111000100_existing_schema.sql dans le SQL Editor.',503);
  console.log('Fonctions transactionnelles MVP1 présentes.');
  const absentTables=serviceTables.filter(name=>!schema.definitions?.[name]);
  const absentServices=serviceFunctions.filter(name=>!schema.paths?.['/rpc/'+name]);
  if(absentTables.length||absentServices.length)throw new ApiError('Services complémentaires à configurer. Tables : '+(absentTables.join(', ')||'OK')+'. Fonctions : '+(absentServices.join(', ')||'OK')+'. Appliquez supabase/migrations/20261116000100_campus_services.sql au schéma CampusConnect existant.',503);
  const bucket=await db.request('bucket/campus-files',{storage:true});
  if(bucket.public!==false)throw new ApiError('Le bucket campus-files doit être privé dans Supabase Storage avant d’envoyer des fichiers.',503);
  console.log('Services campus présents et stockage privé vérifié. La connexion est prête.');
}catch(error){console.error(formatSupabaseDiagnostic(error));process.exitCode=1}
