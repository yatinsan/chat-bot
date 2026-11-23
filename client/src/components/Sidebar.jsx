const ITEMS = [
  { id: 'inbox', label: 'Inbox', icon: 'inbox' },
  { id: 'meetings', label: 'Meetings', icon: 'calendar' },
  { id: 'overview', label: 'Overview', icon: 'grid' },
  { id: 'chat', label: 'Live Chat', icon: 'chat' },
  { id: 'history', label: 'History', icon: 'clock' },
  { id: 'leads', label: 'Leads', icon: 'users' },
  { id: 'business', label: 'Business', icon: 'business' },
];

function Icon({ name }) {
  if (name === 'calendar') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="4" y="5.5" width="16" height="14.5" rx="2" />
        <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" />
      </svg>
    );
  }
  if (name === 'inbox') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 6.5h16v11a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-11Z" />
        <path d="M4 13h4.2a2 2 0 0 0 1.8 1h4a2 2 0 0 0 1.8-1H20" />
      </svg>
    );
  }
  if (name === 'grid') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
    );
  }
  if (name === 'chat') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v7A2.5 2.5 0 0 1 16.5 16H12l-4.2 3.2c-.7.5-1.8 0-1.8-.9V16H7.5A2.5 2.5 0 0 1 5 13.5v-7Z" />
      </svg>
    );
  }
  if (name === 'clock') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v4.5l3 1.5" />
      </svg>
    );
  }
  if (name === 'business') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 10.5h16v8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-8Z" />
        <path d="M8 10.5V7.5A2.5 2.5 0 0 1 10.5 5h3A2.5 2.5 0 0 1 16 7.5v3" />
        <path d="M4 13.5h16" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="9" cy="9" r="3" />
      <circle cx="16" cy="10" r="2.2" />
      <path d="M4.5 18.5c.6-2.4 2.4-3.5 4.5-3.5s3.9 1.1 4.5 3.5" />
      <path d="M14 15.2c1.3-.2 2.6.3 3.4 1.8" />
    </svg>
  );
}

export default function Sidebar({ section, onSection, status, companyName, badges = {} }) {
  const name = companyName?.trim() || 'Pixbit Solutions';
  const mark = name.charAt(0).toUpperCase() || 'P';
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">{mark}</span>
        <div>
          <strong>{name}</strong>
          <small>Sales desk</small>
        </div>
      </div>
      <nav className="nav">
        {ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={section === item.id ? 'nav-item active' : 'nav-item'}
            onClick={() => onSection(item.id)}
          >
            <Icon name={item.icon} />
            {item.label}
            {badges[item.id] > 0 && (
              <span className="nav-badge" aria-label={`${badges[item.id]} waiting`}>{badges[item.id]}</span>
            )}
          </button>
        ))}
      </nav>
      <div className="sidebar-foot">
        <span className={`status-dot status-${status}`} />
        <span>
          {status === 'online' ? 'WebSocket connected' : status === 'connecting' ? 'Connecting…' : 'WebSocket offline'}
        </span>
      </div>
    </aside>
  );
}
