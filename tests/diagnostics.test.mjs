import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ApiError} from '../worker/errors.mjs';
import {formatSupabaseDiagnostic} from '../scripts/supabase-diagnostic.mjs';

const failure=(status,code)=>Object.assign(new ApiError('Erreur Supabase.',502),{supabaseStatus:status,supabaseCode:code});

test('connection checker distinguishes a rejected key from a missing RPC and schema cache',()=>{
  const rejected=formatSupabaseDiagnostic(failure(401));
  assert.match(rejected,/HTTP 401/);assert.match(rejected,/clé est refusée/);assert.doesNotMatch(rejected,/NOTIFY/);
  const missing=formatSupabaseDiagnostic(failure(404,'PGRST202'));
  assert.match(missing,/HTTP 404 \/ PGRST202/);assert.match(missing,/20261111000100_existing_schema.sql/);assert.match(missing,/NOTIFY pgrst/);
});

test('connection checker gives separate actions for missing tables and database privileges',()=>{
  assert.match(formatSupabaseDiagnostic(failure(404,'PGRST205')),/table attendue est introuvable/);
  assert.match(formatSupabaseDiagnostic(failure(403,'42501')),/permissions service_role/);
});

test('connection checker rejects arbitrary diagnostic fields and does not print unexpected exception details',()=>{
  const unknown=Object.assign(new Error('private value that must stay hidden'),{supabaseStatus:'401 secret',supabaseCode:'PGRST202\nprivate value'});
  const output=formatSupabaseDiagnostic(unknown);
  assert.equal(output,'La vérification Supabase a échoué.');
  assert.doesNotMatch(output,/private value/);
});
