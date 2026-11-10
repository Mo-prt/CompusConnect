/** D1 implementation retained for existing deployments. */
export class D1Store {
  constructor(db) { this.db = db; }
  sessionUser(hash, now) {
    return this.db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').bind(hash, now).first();
  }
  createSession(hash, userId, expires) {
    return this.db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(hash, userId, expires).run();
  }
  deleteSession(hash) { return this.db.prepare('DELETE FROM sessions WHERE token_hash=?').bind(hash).run(); }
  async ensureDemoUser(u) {
    await this.db.prepare('INSERT OR IGNORE INTO users(id,email,name,program,semester,role,scope,demo) VALUES(?,?,?,?,?,?,?,1)').bind(u.id,u.email,u.name,u.program,u.semester,u.role,u.scope).run();
    return this.userById(u.id);
  }
  userById(id) { return this.db.prepare('SELECT * FROM users WHERE id=?').bind(id).first(); }
  userByEmail(email, scope) { return this.db.prepare('SELECT * FROM users WHERE email=? AND scope=?').bind(email,scope).first(); }
  createUser(u) {
    return this.db.prepare('INSERT INTO users(id,email,name,password_hash,salt,program,semester,role,scope) VALUES(?,?,?,?,?,?,?,?,?)').bind(u.id,u.email,u.name,u.password_hash,u.salt,u.program,u.semester,u.role,u.scope).run();
  }
  async recordAuthAttempt(key,now) {
    await this.db.prepare('INSERT INTO auth_attempts(key,attempts,window_start) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN window_start<? THEN 1 ELSE attempts+1 END, window_start=CASE WHEN window_start<? THEN ? ELSE window_start END').bind(key,now,now-900000,now-900000,now).run();
    return (await this.db.prepare('SELECT attempts FROM auth_attempts WHERE key=?').bind(key).first()).attempts;
  }
  clearAuthAttempts(key) { return this.db.prepare('DELETE FROM auth_attempts WHERE key=?').bind(key).run(); }
  updateProfile(id,name,program,semester) { return this.db.prepare('UPDATE users SET name=?,program=?,semester=? WHERE id=?').bind(name,program,semester,id).run(); }
  seed(scope,seeds) {
    return this.db.batch(seeds.map(e=>this.db.prepare('INSERT OR IGNORE INTO events(id,scope,owner_id,title,category,date,time,end_time,location,organizer,capacity,program,image,description) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(scope+':'+e.id,scope,scope+':organizer',e.title,e.category,e.date,e.time,e.endTime,e.location,e.organizer,e.capacity,e.program,e.image,e.description)));
  }
  async listEvents(scope,userId) {
    return (await this.db.prepare('SELECT e.*, (SELECT COUNT(*) FROM registrations r WHERE r.event_id=e.id) as registered, EXISTS(SELECT 1 FROM registrations r WHERE r.event_id=e.id AND r.user_id=?) as joined FROM events e WHERE e.scope=? AND (e.status=\'published\' OR e.owner_id=?) ORDER BY e.date,e.time').bind(userId||'',scope,userId||'').all()).results;
  }
  createEvent(e) {
    return this.db.prepare('INSERT INTO events(id,scope,owner_id,title,category,date,time,end_time,location,organizer,capacity,program,image,description) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(e.id,e.scope,e.owner_id,e.title,e.category,e.date,e.time,e.end_time,e.location,e.organizer,e.capacity,e.program,e.image,e.description).run();
  }
  eventById(id,scope) {
    return this.db.prepare('SELECT e.*,(SELECT COUNT(*) FROM registrations r WHERE r.event_id=e.id) as registered FROM events e WHERE e.id=? AND e.scope=?').bind(id,scope).first();
  }
  async joinEvent(id,userId) {
    const result=await this.db.prepare('INSERT OR IGNORE INTO registrations(event_id,user_id) SELECT ?,? WHERE (SELECT COUNT(*) FROM registrations WHERE event_id=?) < (SELECT capacity FROM events WHERE id=? AND status=\'published\')').bind(id,userId,id,id).run();
    return result.meta.changes>0;
  }
  leaveEvent(id,userId) { return this.db.prepare('DELETE FROM registrations WHERE event_id=? AND user_id=?').bind(id,userId).run(); }
  async participants(id) {
    return (await this.db.prepare('SELECT u.name,u.email,u.program,r.created_at FROM registrations r JOIN users u ON u.id=r.user_id WHERE r.event_id=? ORDER BY r.created_at').bind(id).all()).results;
  }
  async updateEvent(id,e) {
    const r=await this.db.prepare('UPDATE events SET title=?,category=?,date=?,time=?,end_time=?,location=?,organizer=?,capacity=?,program=?,image=?,description=? WHERE id=? AND (SELECT COUNT(*) FROM registrations WHERE event_id=?)<=?').bind(e.title,e.category,e.date,e.time,e.end_time,e.location,e.organizer,e.capacity,e.program,e.image,e.description,id,id,e.capacity).run();
    return r.meta.changes>0;
  }
  cancelEvent(id) { return this.db.prepare('UPDATE events SET status=\'cancelled\' WHERE id=?').bind(id).run(); }
}
