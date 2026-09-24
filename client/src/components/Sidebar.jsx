const ITEMS = [
  { id: 'overview', label: 'Overview', icon: 'grid' },
  { id: 'chat', label: 'Live Chat', icon: 'chat' },
  { id: 'history', label: 'History', icon: 'clock' },
  { id: 'leads', label: 'Leads', icon: 'users' },
];

function Icon({ name }) {
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
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="9" cy="9" r="3" />
      <circle cx="16" cy="10" r="2.2" />
      <path d="M4.5 18.5c.6-2.4 2.4-3.5 4.5-3.5s3.9 1.1 4.5 3.5" />
      <path d="M14 15.2c1.3-.2 2.6.3 3.4 1.8" />
    </svg>
  );
}

export default function Sidebar({ section, onSection, status }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">P</span>
        <div>
          <strong>Pixbit</strong>
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
