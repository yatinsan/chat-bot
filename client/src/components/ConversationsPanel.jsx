import { useCallback, useEffect, useRef, useState } from 'react';
import ConversationList from './ConversationList.jsx';
import MessageThread from './MessageThread.jsx';
import TagChips from './TagChips.jsx';
import ChatSummary from './ChatSummary.jsx';
import AiControl from './AiControl.jsx';
import StatusSelect from './StatusSelect.jsx';
import { STATUS_LABEL as MEETING_STATUS_LABEL } from './MeetingCard.jsx';
import { channelOf, chatLabel, contactHref, formatDateTime, scoreBand } from '../lib/format.js';

function sortChats(chats) {
  return [...chats].sort((a, b) => {
    const scoreA = Number(a.lead_score) || 0;
    const scoreB = Number(b.lead_score) || 0;
    if (scoreB !== scoreA) return scoreB - scoreA;
    return String(b.last_at || '').localeCompare(String(a.last_at || ''));
  });
}

// One place for every chat: read it, reply as the team, take it over from the AI,
// and see what the customer needs.
export default function ConversationsPanel({ subscribe, send, status, initialChatId, onGoToMeetings }) {
  const [chats, setChats] = useState([]);
  const [leads, setLeads] = useState([]);
  const [meetings, setMeetings] = useState([]);
  const [selectedId, setSelectedIdState] = useState(initialChatId || null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [typing, setTyping] = useState(false);
  const selectedRef = useRef(initialChatId || null);

  const setSelectedId = useCallback((next) => {
    setSelectedIdState((current) => {
      const value = typeof next === 'function' ? next(current) : next;
      selectedRef.current = value;
      return value;
    });
  }, []);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [chatsRes, leadsRes, meetingsRes] = await Promise.all([
        fetch('/api/chats'),
        fetch('/api/enquiries'),
        fetch('/api/meetings'),
      ]);
      const chatsData = await chatsRes.json();
      const leadsData = await leadsRes.json();
      const meetingsData = await meetingsRes.json();
      if (!chatsRes.ok || !leadsRes.ok || !meetingsRes.ok) {
        throw new Error(chatsData.error || leadsData.error || meetingsData.error || 'Request failed');
      }
      const nextChats = sortChats(Array.isArray(chatsData) ? chatsData : []);
      setChats(nextChats);
      setLeads(Array.isArray(leadsData) ? leadsData : []);
      setMeetings(Array.isArray(meetingsData) ? meetingsData : []);
      setSelectedId((current) => current || nextChats[0]?.chat_id || null);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [setSelectedId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (initialChatId) setSelectedId(initialChatId);
  }, [initialChatId, setSelectedId]);

  useEffect(() => {
    setTyping(false);
    setDraft('');
    if (!selectedId) {
      setMessages([]);
      return undefined;
    }
    let cancelled = false;
    fetch(`/api/messages/${encodeURIComponent(selectedId)}`)
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled && Array.isArray(data)) setMessages(data);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load this chat.');
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  useEffect(() => subscribe((event) => {
    const current = String(selectedRef.current);
    if (event.type === 'lead_deleted' && String(event.chatId) === current) {
      setSelectedId(null);
      setMessages([]);
    }
    if (['message', 'lead', 'lead_deleted', 'meeting', 'ai_control', 'call'].includes(event.type)) load();
    if (event.type === 'message' && String(event.message.chat_id) === current) {
      setMessages((prev) => (
        prev.some((message) => message.id === event.message.id) ? prev : [...prev, event.message]
      ));
    }
    if (event.type === 'typing' && String(event.chatId) === current) setTyping(Boolean(event.active));
    if (event.type === 'error') setError(event.message);
  }), [subscribe, load, setSelectedId]);

  function reply(event) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || !selectedId) return;
    if (status !== 'online') {
      setError('Not connected. Wait a second, then send again.');
      return;
    }
    setDraft('');
    setError('');
    send({ type: 'admin_reply', chatId: selectedId, content });
  }

  const active = chats.find((chat) => String(chat.chat_id) === String(selectedId));
  const leadRow = leads.find((item) => String(item.chat_id) === String(selectedId));
  const lead = leadRow || active;
  const score = Number(lead?.lead_score) || 0;
  const contact = contactHref(lead?.contact);
  const chatMeetings = meetings.filter((meeting) => String(meeting.chat_id) === String(selectedId));

  return (
    <section className="split inbox">
      <ConversationList
        chats={chats}
        selectedId={selectedId}
        onSelect={setSelectedId}
        query={query}
        onQuery={setQuery}
        loading={loading}
      />
      <div className="chat-pane">
        <header className="chat-head">
          <div>
            <h2>{active ? chatLabel(active) : 'Select a chat'}{active?.in_call && <span className="call-badge">In call</span>}</h2>
            <p>
              {active
                ? `${channelOf(active.chat_id)} · ${active.message_count} messages · ${formatDateTime(active.last_at)}`
                : 'Website, Telegram and test chats show up here.'}
            </p>
          </div>
          {active && (
            <AiControl chatId={active.chat_id} paused={Boolean(active.ai_paused)} onChanged={load} onError={setError} />
          )}
        </header>
        {error && <p className="banner">{error}</p>}
        {selectedId && <ChatSummary chatId={selectedId} messageCount={messages.length} />}
        {selectedId
          ? <MessageThread messages={messages} typing={typing} />
          : <div className="thread empty-thread"><p>Pick a conversation.</p></div>}
        {selectedId && (
          <form className="composer" onSubmit={reply}>
            <textarea
              rows={2}
              value={draft}
              placeholder={active?.ai_paused ? 'Reply as the team…' : 'Reply as the team… (sending takes over the chat from the AI)'}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <button type="submit" className="btn primary" disabled={!draft.trim() || status !== 'online'}>
              Send
            </button>
          </form>
        )}
      </div>
      <aside className="requirement">
        <header className="panel-head">
          <h2>What they need</h2>
          {score > 0 && <span className={`score ${scoreBand(score)}`}>{score}/10</span>}
        </header>
        {!selectedId ? (
          <p className="empty-inline">Select a chat to see the brief.</p>
        ) : (
          <div className="requirement-body">
            {leadRow && (
              <div className="requirement-status">
                <span>Stage</span>
                <StatusSelect lead={leadRow} onChanged={load} />
              </div>
            )}
            <TagChips tags={lead?.tags} />
            {score > 0 ? (
              <p className="score-reason">{lead?.score_reason || 'Scored from the conversation.'}</p>
            ) : (
              <p className="score-reason">No score yet. It appears after they describe a real project.</p>
            )}
            <h3>Project</h3>
            <p>{lead?.service && lead.service !== 'Not specified' ? lead.service : 'Not captured yet'}</p>
            <h3>Stack</h3>
            <p>{lead?.stack || 'Not captured yet'}</p>
            <h3>Notes</h3>
            <p className="notes">{lead?.insights || 'No notes yet.'}</p>
            {chatMeetings.length > 0 && (
              <>
                <h3>Meeting</h3>
                {chatMeetings.map((meeting) => (
                  <div key={meeting.id} className="meeting-mini">
                    <span className={`meeting-status meeting-${meeting.status}`}>
                      {MEETING_STATUS_LABEL[meeting.status] || meeting.status}
                    </span>
                    <p>{meeting.preferred_text}</p>
                    {meeting.status === 'countered' && meeting.proposed_text && (
                      <p className="meeting-meta">You suggested: {meeting.proposed_text}</p>
                    )}
                  </div>
                ))}
                {chatMeetings.some((meeting) => meeting.status === 'pending') && (
                  <button type="button" className="btn" onClick={onGoToMeetings}>
                    Review in Meetings
                  </button>
                )}
              </>
            )}
          </div>
        )}
        {selectedId && (
          <footer className="requirement-foot">
            {contact ? (
              <>
                <p className="contact">{contact.display}</p>
                <a className="btn primary" href={contact.href}>{contact.label}</a>
              </>
            ) : (
              <p className="score-reason">No phone or email yet.</p>
            )}
          </footer>
        )}
      </aside>
    </section>
  );
}
