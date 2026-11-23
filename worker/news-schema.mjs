/** The original CampusConnect schema has no category column on news_posts. */
export async function supportsNewsCategories(db){
  try{await db.all('news_posts',{select:'category',limit:'1'});return true}
  catch(error){
    if(['42703','PGRST204'].includes(error.supabaseCode))return false;
    throw error;
  }
}
