import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { categories, questions, questionFor, validateName, validateMessage } from '../src/questions.js';

test('question bank is original, categorized and deterministic', () => {
  assert.equal(questions.length, 36);
  assert.equal(new Set(questions.map(q => q.text)).size, 36);
  for (const c of categories) {
    const room = { id:'room-123', category:c.id, question_index:0 };
    const round = Array.from({length:12},(_,question_index) => questionFor({...room, question_index}));
    assert.equal(new Set(round.map(q => q.id)).size,12);
    assert(round.every(q => q.category === c.id));
    assert.deepEqual(questionFor(room),questionFor({...room}));
  }
  assert.equal(validateName('  小满  '),'小满');
  assert.throws(() => validateName(' '));
  assert.throws(() => validateMessage('x'.repeat(1001)));
});

test('database enforces membership, isolation, lifecycle and permissions', async t => {
  const db = new PGlite();
  const ids = ['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003'];
  await db.exec(`create role anon; create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon;
    grant execute on function auth.uid() to authenticated,anon;`);
  for (const id of ids) await db.query('insert into auth.users values ($1)',[id]);
  const schema = await readFile(new URL('../supabase/schema.sql',import.meta.url),'utf8');
  await db.exec(schema);
  await db.exec(schema); // Verify repeatable migration.
  const as = async id => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);
    await db.exec('set role authenticated');
  };
  const rows = async(sql,params=[]) => (await db.query(sql,params)).rows;
  await as(ids[0]);
  const [room] = await rows("select * from public.create_room('小满')");
  await t.test('outsider cannot discover rooms, messages or members',async()=>{
    await as(ids[2]);
    assert.equal((await rows('select * from rooms')).length,0);
    assert.equal((await rows('select * from room_members')).length,0);
    assert.equal((await rows('select * from messages')).length,0);
    await assert.rejects(rows('select public.end_room($1)',[room.id]));
    await assert.rejects(rows('select public.advance_question($1,0,\'deep\')',[room.id]));
    await assert.rejects(rows('select public.cleanup_expired_rooms()'));
    await assert.rejects(rows('insert into room_members(room_id,user_id,display_name) values($1,$2,\'bad\')',[room.id,ids[2]]));
  });
  await t.test('second member joins, third is rejected and rejoin is idempotent',async()=>{
    await as(ids[1]);
    await rows("select * from join_room($1,'木木')",[room.invite_token]);
    await rows("select * from join_room($1,'木木')",[room.invite_token]);
    assert.equal((await rows('select * from room_members')).length,2);
    await as(ids[2]);
    await assert.rejects(rows("select * from join_room($1,'第三人')",[room.invite_token]),/两个人/);
    await assert.rejects(rows("select * from join_room('invalid','第三人')"),/不存在/);
  });
  await t.test('messages are shared only with members, reject impersonation and invalid text',async()=>{
    await as(ids[0]);
    await rows('insert into messages(room_id,sender_id,text) values($1,$2,$3)',[room.id,ids[0],'  你好呀  ']);
    await assert.rejects(rows('insert into messages(room_id,sender_id,text) values($1,$2,$3)',[room.id,ids[1],'impersonation']));
    await assert.rejects(rows('insert into messages(room_id,sender_id,text) values($1,$2,$3)',[room.id,ids[0],'  ']));
    await as(ids[1]);
    assert.equal((await rows('select * from messages'))[0].text,'你好呀');
    await assert.rejects(rows("update rooms set question_index=900 where id=$1",[room.id]));
    await as(ids[2]);
    assert.equal((await rows('select * from messages')).length,0);
    await assert.rejects(rows('insert into messages(room_id,sender_id,text) values($1,$2,$3)',[room.id,ids[2],'intruder']));
  });
  await t.test('question advancement uses expected index and validates category',async()=>{
    await as(ids[0]);
    await rows("select advance_question($1,0,'deep')",[room.id]);
    await as(ids[1]);
    await rows("select advance_question($1,0,'wild')",[room.id]);
    const [current] = await rows('select * from rooms where id=$1',[room.id]);
    assert.equal(current.question_index,1);
    assert.equal(current.category,'deep');
    await assert.rejects(rows("select advance_question($1,1,'invalid')",[room.id]));
  });
  await t.test('ending clears messages and prevents send/join/advance',async()=>{
    await rows('select end_room($1)',[room.id]);
    assert.equal((await rows('select * from messages')).length,0);
    await assert.rejects(rows('insert into messages(room_id,sender_id,text) values($1,$2,$3)',[room.id,ids[1],'too late']),/结束/);
    await assert.rejects(rows("select * from join_room($1,'木木')",[room.invite_token]),/结束/);
    await assert.rejects(rows("select advance_question($1,1,'light')",[room.id]),/结束/);
  });
  await t.test('expiry blocks access and writes; admin cleanup cascades',async()=>{
    await as(ids[0]);
    const [expiring] = await rows("select * from create_room('小满')");
    await rows('insert into messages(room_id,sender_id,text) values($1,$2,$3)',[expiring.id,ids[0],'ephemeral']);
    await db.exec('reset role');
    await rows("update rooms set expires_at=now()-interval '1 minute' where id=$1",[expiring.id]);
    await as(ids[0]);
    assert.equal((await rows('select * from messages')).length,0);
    await assert.rejects(rows('insert into messages(room_id,sender_id,text) values($1,$2,$3)',[expiring.id,ids[0],'expired']),/过期/);
    await as(ids[1]);
    await assert.rejects(rows("select * from join_room($1,'木木')",[expiring.invite_token]),/过期/);
    await db.exec('reset role');
    await rows('select cleanup_expired_rooms()');
    assert.equal((await rows('select * from rooms where id=$1',[expiring.id])).length,0);
    assert.equal((await rows('select * from room_members where room_id=$1',[expiring.id])).length,0);
    assert.equal((await rows('select * from messages where room_id=$1',[expiring.id])).length,0);
  });
  await db.close();
});
