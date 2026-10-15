// Adapted Supabase messaging patterns; attribution and modification notes: NOTICE.
import { createClient } from '@supabase/supabase-js';
import { validateMessage, validateName } from './questions.js';
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const configured = Boolean(url && key);
let client;
let authPromise;
function supabase() {
  client ||= createClient(url, key);
  return client;
}
async function authenticated() {
  authPromise ||= (async () => {
    const db = supabase();
    const { data, error } = await db.auth.getSession();
    if (error) throw error;
    if (data.session) return data.session.user.id;
    const result = await db.auth.signInAnonymously();
    if (result.error) throw result.error;
    return result.data.user.id;
  })().catch(error => { authPromise = null; throw error; });
  return authPromise;
}
function checked(result) {
  if (result.error) throw result.error;
  return result.data;
}
const demoPrefix = 'closer-demo:';
const listeners = new Set();
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('closer-demo') : null;
channel?.addEventListener('message', () => listeners.forEach(fn => fn()));
window.addEventListener('storage', event => { if (event.key?.startsWith(demoPrefix)) listeners.forEach(fn => fn()); });
function demoNotify() { channel?.postMessage('update'); listeners.forEach(fn => fn()); }
function readDemo(token) {
  const raw = localStorage.getItem(demoPrefix + token);
  if (!raw) throw new Error('房间不存在，请检查邀请链接。');
  return JSON.parse(raw);
}
async function withDemo(token, mutate) {
  if (!navigator.locks) throw new Error('体验模式需要支持 Web Locks 的新版浏览器。');
  return navigator.locks.request(demoPrefix + token, () => {
    const state = readDemo(token);
    const result = mutate(state);
    localStorage.setItem(demoPrefix + token, JSON.stringify(state));
    demoNotify();
    return result;
  });
}
function assertOpen(state) {
  if (state.room.closed_at || Date.parse(state.room.expires_at) <= Date.now()) throw new Error('房间已结束或过期。');
}
export function createBackend(demo) {
  let userId;
  let token;
  const store = demo ? sessionStorage : localStorage;
  const backend = {
    demo,
    get userId() { return userId; },
    get savedRoom() { return store.getItem(demo ? 'closer-demo-room' : 'closer-room'); },
    remember(id) { store.setItem(demo ? 'closer-demo-room' : 'closer-room', id); },
    forget() { store.removeItem(demo ? 'closer-demo-room' : 'closer-room'); },
    async init() {
      if (demo) {
        userId = sessionStorage.getItem('closer-demo-user') || crypto.randomUUID();
        sessionStorage.setItem('closer-demo-user', userId);
      } else userId = await authenticated();
    },
    async create(name) {
      name = validateName(name);
      if (!demo) return checked(await supabase().rpc('create_room', { display_name: name }));
      token = crypto.randomUUID().replaceAll('-', '');
      const room = { id: crypto.randomUUID(), invite_token: token, question_index: 0, category: 'light', closed_at: null, expires_at: new Date(Date.now() + 86400000).toISOString() };
      localStorage.setItem(demoPrefix + token, JSON.stringify({ room, members: [{ user_id: userId, display_name: name }], messages: [] }));
      demoNotify();
      return room;
    },
    async join(invite, name) {
      name = validateName(name);
      if (!demo) return checked(await supabase().rpc('join_room', { invitation: invite, display_name: name }));
      token = invite;
      return withDemo(token, state => {
        assertOpen(state);
        if (!state.members.some(m => m.user_id === userId)) {
          if (state.members.length >= 2) throw new Error('这个房间已经有两个人啦。');
          state.members.push({ user_id: userId, display_name: name });
        }
        return state.room;
      });
    },
    async load(id) {
      if (!demo) {
        const db = supabase();
        const [room, members, messages] = await Promise.all([
          db.from('rooms').select('*').eq('id', id).single(),
          db.from('room_members').select('*').eq('room_id', id).order('joined_at'),
          db.from('messages').select('*').eq('room_id', id).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(200),
        ]);
        return { room: checked(room), members: checked(members), messages: checked(messages).reverse() };
      }
      if (!token) {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k.startsWith(demoPrefix)) {
            const state = JSON.parse(localStorage.getItem(k));
            if (state.room.id === id) { token = state.room.invite_token; break; }
          }
        }
      }
      const state = readDemo(token);
      if (!state.members.some(m => m.user_id === userId)) throw new Error('你还没有加入这个房间。');
      return state;
    },
    async send(id, value) {
      const text = validateMessage(value);
      if (!demo) {
        checked(await supabase().from('messages').insert({ room_id: id, sender_id: userId, text }));
        return;
      }
      return withDemo(token, state => {
        assertOpen(state);
        state.messages.push({ id: crypto.randomUUID(), sender_id: userId, text, created_at: new Date().toISOString() });
        state.messages = state.messages.slice(-200);
      });
    },
    async advance(id, index, category) {
      if (!demo) return checked(await supabase().rpc('advance_question', { target_room: id, expected_index: index, next_category: category }));
      return withDemo(token, state => {
        assertOpen(state);
        if (state.room.question_index !== index) return;
        state.room.question_index++;
        state.room.category = category;
      });
    },
    async end(id) {
      if (!demo) return checked(await supabase().rpc('end_room', { target_room: id }));
      return withDemo(token, state => { state.room.closed_at = new Date().toISOString(); state.messages = []; });
    },
    subscribe(id, callback, status) {
      if (demo) {
        listeners.add(callback);
        status('体验模式');
        return () => listeners.delete(callback);
      }
      const db = supabase();
      const subscription = db.channel(`room:${id}:${crypto.randomUUID()}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `room_id=eq.${id}` }, callback)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'room_members', filter: `room_id=eq.${id}` }, callback)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${id}` }, callback)
        .subscribe(state => {
          status(state === 'SUBSCRIBED' ? '已连接' : '正在重连');
          if (state === 'SUBSCRIBED') callback();
        });
      return () => { db.removeChannel(subscription); };
    },
  };
  return backend;
}
