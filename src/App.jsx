import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, ArrowUpRight, Check, ChevronRight, Copy, Heart, Leaf, Link, LoaderCircle, LogOut, MessageCircle, MoveRight, RefreshCw, ShieldCheck, Sparkles, X } from 'lucide-react';
import { configured, createBackend } from './backend.js';
import { categories, questionFor } from './questions.js';

function invitation() { return new URLSearchParams(location.hash.slice(1)).get('invite'); }
function errorText(error) {
  const message = error?.message || '操作没有成功，请再试一次。';
  if (message === 'Failed to fetch') return '连接失败，请检查网络后重试。';
  if (/JSON object requested|0 rows|PGRST116/.test(message)) return '房间已过期、已清理，或你尚未加入。';
  return message;
}
const demoAtStart = new URLSearchParams(location.search).get('demo') === '1';
export default function App() {
  const [demo, setDemo] = useState(demoAtStart);
  const backend = useMemo(() => createBackend(demo), [demo]);
  const [invite, setInvite] = useState(invitation);
  const [name, setName] = useState('');
  const [snapshot, setSnapshot] = useState(null);
  const [roomId, setRoomId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [status, setStatus] = useState('连接中');
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [initializing, setInitializing] = useState(false);
  const bottom = useRef(null);
  const textarea = useRef(null);
  const modalRef = useRef(null);

  useEffect(() => {
    const handler = () => setInvite(invitation());
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);
  useEffect(() => {
    if (!configured && !demo) return;
    let active = true;
    setInitializing(true);
    backend.init().then(async () => {
      if (!active) return;
      const saved = backend.savedRoom;
      if (!saved) return;
      const state = await backend.load(saved);
      if (!active || (invitation() && state.room.invite_token !== invitation())) return;
      setSnapshot(state); setRoomId(saved);
    }).catch(e => { if (active) setError(errorText(e)); })
      .finally(() => { if (active) setInitializing(false); });
    return () => { active = false; };
  }, [backend, demo]);
  useEffect(() => {
    if (!roomId) return;
    let active = true;
    let inFlight = false;
    let again = false;
    const refresh = async () => {
      if (inFlight) { again = true; return; }
      inFlight = true;
      try { const state = await backend.load(roomId); if (active) setSnapshot(state); }
      catch (e) { if (active) setError(errorText(e)); }
      finally {
        inFlight = false;
        if (again && active) { again = false; refresh(); }
      }
    };
    const unsubscribe = backend.subscribe(roomId, refresh, value => active && setStatus(value));
    const interval = setInterval(() => { setNow(Date.now()); refresh(); }, 5000);
    const visible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('online', refresh);
    refresh();
    return () => { active = false; unsubscribe(); clearInterval(interval); document.removeEventListener('visibilitychange', visible); window.removeEventListener('online', refresh); };
  }, [roomId, backend]);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [snapshot?.messages.length]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 2800); return () => clearTimeout(timer); }, [toast]);

  useEffect(() => {
    if (!confirmEnd) return;
    const previous = document.activeElement;
    const handleKey = event => {
      if (event.key === 'Escape' && !busy) setConfirmEnd(false);
      if (event.key !== 'Tab') return;
      const focusable = [...modalRef.current.querySelectorAll('button:not(:disabled)')];
      if (!focusable.length) { event.preventDefault(); return; }
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => { document.removeEventListener('keydown', handleKey); previous?.focus(); };
  }, [confirmEnd, busy]);

  async function enter(event) {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      await backend.init();
      const room = invite ? await backend.join(invite, name) : await backend.create(name);
      backend.remember(room.id);
      setSnapshot(await backend.load(room.id)); setRoomId(room.id);
      history.replaceState(null, '', `${location.pathname}${demo ? '?demo=1' : ''}#invite=${room.invite_token}`);
      setInvite(room.invite_token);
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }
  function goHome() {
    backend.forget(); setRoomId(null); setSnapshot(null); setConfirmEnd(false); setError(''); setInvite(null);
    history.replaceState(null, '', `${location.pathname}${demo ? '?demo=1' : ''}`);
  }
  async function copyInvite() {
    const link = `${location.origin}${location.pathname}${demo ? '?demo=1' : ''}#invite=${snapshot.room.invite_token}`;
    try { await navigator.clipboard.writeText(link); setToast('邀请链接已复制，发给那个人吧'); }
    catch { setError(`复制失败，请手动复制地址栏中的邀请链接。`); }
  }
  async function advance(category) {
    setBusy(true); setError('');
    try { await backend.advance(roomId, snapshot.room.question_index, category); setSnapshot(await backend.load(roomId)); }
    catch(e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }
  async function send(event) {
    event?.preventDefault();
    if (!draft.trim() || sending) return;
    setSending(true); setError('');
    try {
      await backend.send(roomId, draft);
      setDraft(''); setSnapshot(await backend.load(roomId)); textarea.current?.focus();
    } catch(e) { setError(errorText(e)); }
    finally { setSending(false); }
  }
  async function end() {
    setBusy(true); setError('');
    try { await backend.end(roomId); setConfirmEnd(false); setSnapshot(await backend.load(roomId)); }
    catch(e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }
  const closed = snapshot && (snapshot.room.closed_at || Date.parse(snapshot.room.expires_at) <= now);
  const me = snapshot?.members.find(m => m.user_id === backend.userId);
  const partner = snapshot?.members.find(m => m.user_id !== backend.userId);
  const question = snapshot && questionFor(snapshot.room);

  return <div className={roomId ? 'app in-room' : 'app'}>
    <header className="site-header"><a className="brand" href={`${import.meta.env.BASE_URL}${demo ? '?demo=1' : ''}`} aria-label="靠近一点首页"><span className="brand-icon"><MessageCircle size={20}/><Heart size={9}/></span>靠近一点<span className="brand-en">a little closer</span></a><div className="header-note"><span className="tiny-dot"/>{demo ? '本机体验模式' : '留一点时间，好好聊天'}</div></header>
    {demo && <div className="demo-banner">本机体验 · 仅同一浏览器的不同标签页互通，不支持异地聊天。{!configured && ' 配置 Supabase 后可正式使用。'}</div>}
    {error && <div className="error-banner" role="alert"><span>{error}</span><button aria-label="关闭提示" onClick={() => setError('')}><X size={16}/></button></div>}
    {!roomId ? <main className="landing">
      <section className="hero-copy"><div className="eyebrow"><span className="little-star">✳</span> 两个人，刚刚好</div><h1>有些话，<br/>从一个<span className="underlined">好问题</span><br/>开始。</h1><p className="hero-description">放下“在干嘛”，聊点不一样的。<br/>一个只属于你们的小房间，<br/>一些有趣的问题，和慢慢靠近的距离。</p><div className="feature-pills"><span><ShieldCheck size={15}/> 双人专属</span><span><Sparkles size={15}/> 灵感题卡</span><span><Leaf size={15}/> 无需注册</span></div><div className="hand-note">不必很会聊天，做自己就好。<svg width="68" height="30" viewBox="0 0 68 30"><path d="M2 5 Q25 34 59 16 M49 14 L61 15 L56 26" fill="none" stroke="currentColor" strokeWidth="1.4"/></svg></div></section>
      <section className="entry-area"><div className="floating-note"><span>✦</span> 今天，想了解你多一点</div><div className="entry-card"><div className="card-topline"><span>LET’S MAKE SOME TIME</span><span>01 / 02</span></div><div className="two-faces"><div className="face face-one"><i/><i/><b/></div><span className="face-spark">✳</span><div className="face face-two"><i/><i/><b/></div></div><h2>{invite ? '有人在等你，一起聊聊吧' : '把时间留给你们'}</h2><p className="entry-subtitle">{invite ? '填个昵称，走进你们的小房间。' : '建一个小房间，邀请一个想聊天的人。'}</p>
      <form onSubmit={enter}><label htmlFor="nickname">怎么称呼你？</label><input id="nickname" value={name} onChange={e => setName(e.target.value)} maxLength={20} placeholder="一个你喜欢的昵称" autoComplete="nickname" required/><button className="primary-button" type="submit" disabled={busy || initializing || (!configured && !demo)}>{busy || initializing ? <LoaderCircle className="spin" size={18}/> : <>{invite ? '加入小房间' : '创建小房间'}<ArrowUpRight size={19}/></>}</button></form>
      {!configured && !demo ? <div className="setup-note">正式聊天还需连接 Supabase。<button className="text-button" onClick={() => { history.replaceState(null, '', `${location.pathname}?demo=1${location.hash}`); setDemo(true); setError(''); }}>先体验一下 <MoveRight size={14}/></button></div> : <div className="entry-footnote"><ShieldCheck size={13}/>{demo ? '体验数据仅保存在此浏览器' : '无需手机号 · 无需邮箱 · 仅限两人'}</div>}
      </div><div className="preview-question"><span className="preview-icon"><Sparkles size={17}/></span><div><small>也许，你们会从这句开始</small><p>“如果明天突然放假，你最想拉我去哪里？”</p></div></div></section>
      <section className="how-it-works"><div><span>01</span><p>开一个小房间<small>给这段对话留个位置</small></p></div><ChevronRight size={16}/><div><span>02</span><p>分享给那个 TA<small>一个链接，就能见面</small></p></div><ChevronRight size={16}/><div><span>03</span><p>让话题自然发生<small>从轻松破冰到认真了解</small></p></div></section>
    </main> : <main className="room-layout">
      <aside className="room-sidebar"><div className="room-label"><span className="tiny-dot"/> OUR LITTLE SPACE</div><h1>这一刻，<br/>只聊<span>我们。</span></h1><p>没有标准答案，<br/>每一个回答都值得被听见。</p><div className="members"><div><span className="avatar peach">{me?.display_name.slice(0,1)}</span><div><strong>{me?.display_name}</strong><small>你 · 已加入</small></div><Check size={15}/></div><div><span className={`avatar ${partner ? 'sage' : 'empty-avatar'}`}>{partner?.display_name.slice(0,1) || '+'}</span><div><strong>{partner?.display_name || '等一个想聊天的人'}</strong><small>{partner ? '已加入房间' : '分享链接，邀请 TA'}</small></div>{partner && <Check size={15}/>}</div></div><button className="outline-button" onClick={copyInvite} disabled={Boolean(closed)}><Link size={16}/> 复制邀请链接<Copy size={14}/></button><div className="privacy-note"><ShieldCheck size={15}/><p>房间仅限两人。24 小时后过期并停止访问，记录按清理计划删除；主动结束会立即清空消息。</p></div><button className="end-button" onClick={() => closed ? goHome() : setConfirmEnd(true)}><LogOut size={15}/>{closed ? '回到首页' : '结束这次聊天'}</button></aside>
      <section className="conversation"><header className="conversation-header"><div><MessageCircle size={18}/><strong>你们的小房间</strong><span className="member-count">{snapshot.members.length}/2</span></div><span className="connection"><span className="tiny-dot"/>{closed ? '已结束' : status}</span></header>
      {closed ? <div className="closed-room"><Heart size={36}/><h2>这段对话，先珍藏在心里。</h2><p>{snapshot.room.closed_at ? '房间已结束，聊天消息已清空。' : '房间已过期，无法继续聊天。'}</p><button className="primary-button" onClick={goHome}>回到首页 <MoveRight size={17}/></button></div> : <>
      <section className="question-section"><div className="category-tabs" aria-label="问题分类">{categories.map(c => <button key={c.id} className={snapshot.room.category === c.id ? 'active' : ''} onClick={() => advance(c.id)} disabled={busy} aria-pressed={snapshot.room.category === c.id}><span style={{ background: c.color }}/>{c.name}</button>)}</div><div className={`question-card ${snapshot.room.category}`}><div className="question-meta"><span><Sparkles size={14}/> 给你们的灵感题卡</span><span>#{String(snapshot.room.question_index + 1).padStart(2,'0')}</span></div><h2 key={question.id}>{question.text}</h2><div className="question-bottom"><span>慢慢说，我在听。</span><button disabled={busy} onClick={() => advance(snapshot.room.category)}><RefreshCw size={14} className={busy ? 'spin' : ''}/> 换个问题</button></div></div></section>
      <div className="messages" role="log" aria-label="聊天消息" aria-live="polite"><div className="chat-start"><span/>今天 · 给彼此一点时间<span/></div>{snapshot.messages.length === 0 && <div className="empty-chat"><span>✳</span><p>{partner ? '人齐啦，从上面的问题开始吧。' : '房间准备好了，等 TA 来就开始。'}</p><small>{partner ? '不必想好完美的答案，想到什么就说什么。' : '先复制邀请链接，发给你想聊天的人。'}</small></div>}{snapshot.messages.map(message => { const own = message.sender_id === backend.userId; const author = snapshot.members.find(m => m.user_id === message.sender_id); return <div key={message.id} className={`message-row ${own ? 'own' : ''}`}><span className={`avatar ${own ? 'peach' : 'sage'}`}>{author?.display_name.slice(0,1) || '?'}</span><div className="message-content"><div className="message-byline">{author?.display_name || '对方'}<time>{new Date(message.created_at).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}</time></div><div className="message-bubble">{message.text}</div></div></div>; })}<div ref={bottom}/></div>
      <form className="composer" onSubmit={send}><div className="composer-input"><textarea ref={textarea} aria-label="聊天内容" placeholder="想到什么，就说什么…" rows={1} value={draft} maxLength={1000} disabled={sending} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}/><button aria-label="发送消息" disabled={!draft.trim() || sending}>{sending ? <LoaderCircle size={19} className="spin"/> : <ArrowUp size={21}/>}</button></div><div className="composer-hint"><span>Enter 发送 · Shift + Enter 换行</span><span>{draft.length}/1000</span></div></form></>}
      </section></main>}
    {!roomId && <footer className="site-footer"><span>少一点屏幕的距离，多一点真实的靠近。</span><span>MADE FOR TWO <Heart size={11}/></span></footer>}
    {toast && <div className="toast" role="status"><Check size={16}/>{toast}</div>}
    {confirmEnd && <div className="modal-backdrop" onClick={() => !busy && setConfirmEnd(false)}><section ref={modalRef} className="modal" role="dialog" aria-modal="true" aria-labelledby="end-title" onClick={e => e.stopPropagation()}><Heart size={28}/><h2 id="end-title">结束这次聊天？</h2><p>双方将无法继续聊天，消息会立即删除。<br/>想再聊时，随时可以开一个新房间。</p><div><button className="outline-button" autoFocus onClick={() => setConfirmEnd(false)} disabled={busy}>再聊一会儿</button><button className="primary-button" onClick={end} disabled={busy}>{busy ? '正在结束…' : '结束并清空'}</button></div></section></div>}
  </div>;
}
