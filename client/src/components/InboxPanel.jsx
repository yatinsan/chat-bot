import { useCallback, useEffect, useState } from 'react';
import ConversationList from './ConversationList.jsx';
import MessageThread from './MessageThread.jsx';
import MeetingCard from './MeetingCard.jsx';
import TagChips from './TagChips.jsx';
import { channelOf, chatLabel, contactHref, formatDateTime, scoreBand } from '../lib/format.js';

function sortChats(chats) {
  return [...chats].sort((a, b) => {
    const scoreA = Number(a.lead_score) || 0;
    const scoreB = Number(b.lead_score) || 0;
    if (scoreB !== scoreA) return scoreB - scoreA;
    return String(b.last_at || '').localeCompare(String(a.last_at || ''));
  });
}

export default function InboxPanel({ subscribe }) {
  const [chats, setChats] = useState([]);
  const [leads, setLeads] = useState([]);
  const [meetings, setMeetings] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [messages, setMessages] = useState([]);
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
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
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
    if (event.type === 'lead_deleted' && String(event.chatId) === String(selectedId)) {
      setSelectedId(null);
      setMessages([]);
    }
    if (event.type === 'message' || event.type === 'lead' || event.type === 'lead_deleted' || event.type === 'meeting') load();
    if (event.type === 'message' && String(event.message.chat_id) === String(selectedId)) {
      setMessages((prev) => (
        prev.some((message) => message.id === event.message.id) ? prev : [...prev, event.message]
      ));
    }
  }), [subscribe, load, selectedId]);

  const active = chats.find((chat) => String(chat.chat_id) === String(selectedId));
  const lead = leads.find((item) => String(item.chat_id) === String(selectedId)) || active;
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
            <h2>{active ? chatLabel(active) : 'Select a chat'}</h2>
            <p>
              {active
                ? `${channelOf(active.chat_id)} · ${active.message_count} messages · ${formatDateTime(active.last_at)}`
                : 'Website and Telegram chats show up here.'}
            </p>
          </div>
        </header>
        {error && <p className="banner">{error}</p>}
        {selectedId
          ? <MessageThread messages={messages} />
          : <div className="thread empty-thread"><p>Pick a conversation.</p></div>}
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
                <h3>Meeting requests</h3>
                {chatMeetings.map((meeting) => (
                  <MeetingCard key={meeting.id} meeting={meeting} onDecided={load} />
                ))}
              </>
            )}
            <h3>Contact</h3>
            {contact ? (
              <>
                <p className="contact">{contact.display}</p>
                <a className="btn primary" href={contact.href}>{contact.label}</a>
              </>
            ) : (
              <p className="empty-inline">No phone or email yet.</p>
            )}
          </div>
        )}
      </aside>
    </section>
  );
}
