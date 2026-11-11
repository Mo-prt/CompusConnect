import {ApiError} from '../worker/errors.mjs';

/** CLI-only messages. Never include the remote response body or key. */
export function formatSupabaseDiagnostic(error) {
  const lines=[error instanceof ApiError ? error.message : 'La vérification Supabase a échoué.'];
  const status=Number.isInteger(error?.supabaseStatus)&&error.supabaseStatus>=100&&error.supabaseStatus<=599?error.supabaseStatus:null;
  const code=typeof error?.supabaseCode==='string'&&/^[A-Z0-9_]{1,32}$/.test(error.supabaseCode)?error.supabaseCode:null;
  if(status||code)lines.push('Diagnostic : '+[status?'HTTP '+status:null,code].filter(Boolean).join(' / '));
  if(status===401){
    lines.push('La clé est refusée. Vérifiez la clé serveur du même projet, sans espace ni ponctuation ajoutée.');
  }else if(code==='PGRST202'){
    lines.push('La fonction RPC attendue est absente du cache de l’API, ou sa signature ne correspond pas.');
    lines.push('Appliquez supabase/migrations/20261111000100_existing_schema.sql sur le schéma existant. Cette migration ne crée ni ne supprime de tables.');
    lines.push("Si le schéma existe déjà, vérifiez les fonctions puis exécutez dans le SQL Editor : NOTIFY pgrst, 'reload schema';");
  }else if(code==='PGRST205'||code==='42P01'){
    lines.push('Une table attendue est introuvable. Vérifiez la migration PostgreSQL et le projet sélectionné.');
  }else if(status===403||code==='42501'){
    lines.push('Accès refusé. Vérifiez la clé serveur et les permissions service_role prévues par la migration.');
  }
  return lines.join('\n');
}
