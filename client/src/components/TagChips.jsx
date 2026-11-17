import { tagLabel } from '../lib/tags.js';

export default function TagChips({ tags }) {
  if (!Array.isArray(tags) || tags.length === 0) return null;
  return (
    <span className="tag-chips">
      {tags.map((tag) => (
        <span key={tag} className={`tag tag-${tag.replace(/_/g, '-')}`}>{tagLabel(tag)}</span>
      ))}
    </span>
  );
}
